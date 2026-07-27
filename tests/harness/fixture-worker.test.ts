import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test, vi } from "vitest";

import { releaseManifestSnapshotPath } from "@palimpsest/run-control";

import {
  commitReleaseAnalysis,
  createFixtureGitAuthentication,
  FIXTURE_GIT_CREDENTIAL_ENV,
  observeReleaseOrdinal,
  observeReleasedInputs,
  waitForConfiguredFixtureLaunchBarrier,
  waitForFixtureLaunchBarrier,
} from "../../tools/harness/fixture-worker.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-fixture-worker-"));
  temporaryRoots.push(root);
  return root;
}

async function writeRelease(
  currentPath: string,
  ordinal: number,
  chapters: Array<{ index: number; bytes: Buffer }>,
): Promise<void> {
  await mkdir(dirname(releaseManifestSnapshotPath(currentPath, ordinal)), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    releaseOrdinal: ordinal,
    chapterIndexes: chapters.map(({ index }) => index),
    chapters: chapters.map(({ bytes }) => ({
      artifactType: "cipher-chapter",
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  };
  for (const { index, bytes } of chapters) {
    await writeFile(join(dirname(currentPath), `${String(index).padStart(3, "0")}.txt`), bytes);
  }
  await writeFile(releaseManifestSnapshotPath(currentPath, ordinal), JSON.stringify(manifest));
  const temporaryCurrent = `${currentPath}.tmp`;
  await writeFile(temporaryCurrent, JSON.stringify(manifest));
  await rename(temporaryCurrent, currentPath);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("fixture launch barrier", () => {
  test("keeps Git credentials out of the invocation endpoint and transient Git config", () => {
    const secret = "a".repeat(43);
    const authentication = createFixtureGitAuthentication({
      agentId: "agent-1",
      endpoint: "http://git-gateway:8080/agent-1/repository.git",
      environment: { [FIXTURE_GIT_CREDENTIAL_ENV]: secret },
    });
    const header = authentication.environment.GIT_CONFIG_VALUE_0;
    expect(authentication.environment.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(header).toMatch(/^Authorization: Basic /);
    expect(
      Buffer.from(header!.slice("Authorization: Basic ".length), "base64").toString("utf8"),
    ).toBe(`agent-1:${secret}`);
    expect(header).not.toContain(secret);

    expect(() =>
      createFixtureGitAuthentication({
        agentId: "agent-1",
        endpoint: "http://agent-1:secret@git-gateway:8080/agent-1/repository.git",
        environment: { [FIXTURE_GIT_CREDENTIAL_ENV]: secret },
      }),
    ).toThrow(/credential-free/);
    expect(() =>
      createFixtureGitAuthentication({
        agentId: "agent-1",
        endpoint: "http://git-gateway:8080/agent-1/repository.git",
        environment: {},
      }),
    ).toThrow(/credential-free/);
  });

  test("is optional and rejects partial environment configuration", async () => {
    await expect(waitForConfiguredFixtureLaunchBarrier({}, 100)).resolves.toBeUndefined();
    await expect(
      waitForConfiguredFixtureLaunchBarrier({ PALIMPSEST_FIXTURE_READY_PATH: "/tmp/ready" }, 100),
    ).rejects.toThrow(/both/);
    await expect(
      waitForConfiguredFixtureLaunchBarrier(
        {
          PALIMPSEST_FIXTURE_READY_PATH: "/tmp/ready",
          PALIMPSEST_FIXTURE_RELEASE_PATH: "/tmp/release",
          PALIMPSEST_FIXTURE_BARRIER_TIMEOUT_MS: "10ms",
        },
        100,
      ),
    ).rejects.toThrow(/positive decimal integer/);
  });

  test("publishes readiness atomically and waits for host release", async () => {
    const root = await temporaryRoot();
    const readyPath = join(root, "barrier", "agent.ready");
    const releasePath = join(root, "barrier", "host.release");
    const waiting = waitForFixtureLaunchBarrier({
      readyPath,
      releasePath,
      timeoutMs: 1_000,
      pollIntervalMs: 5,
    });

    await vi.waitFor(async () => {
      await expect(readFile(readyPath, "utf8")).resolves.toBe("ready\n");
    });
    await writeFile(releasePath, "release\n");
    await expect(waiting).resolves.toBeUndefined();
    await expect(readFile(join(dirname(readyPath), ".agent.ready.tmp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("fails closed when the host never releases the worker", async () => {
    const root = await temporaryRoot();
    await expect(
      waitForFixtureLaunchBarrier({
        readyPath: join(root, "agent.ready"),
        releasePath: join(root, "host.release"),
        timeoutMs: 20,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("fixture release observation", () => {
  test("rejects retrospective startup when release two is already current", async () => {
    const root = await temporaryRoot();
    const currentPath = join(root, "released", "release-manifest.json");
    const first = { index: 10, bytes: Buffer.from("first\n") };
    const second = { index: 11, bytes: Buffer.from("second\n") };
    await writeRelease(currentPath, 1, [first]);
    await writeRelease(currentPath, 2, [first, second]);

    await expect(
      observeReleasedInputs(currentPath, {
        expectedReleaseCount: 2,
        timeoutMs: 100,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/retrospectively/);
  });

  test("waits for a monotonic second release and rejects altered chapter bytes", async () => {
    const root = await temporaryRoot();
    const currentPath = join(root, "released", "release-manifest.json");
    const first = { index: 10, bytes: Buffer.from("first\n") };
    const second = { index: 11, bytes: Buffer.from("second\n") };
    await writeRelease(currentPath, 1, [first]);

    const waiting = observeReleasedInputs(currentPath, {
      expectedReleaseCount: 2,
      timeoutMs: 1_000,
      pollIntervalMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeRelease(currentPath, 2, [first, second]);
    await expect(waiting).resolves.toHaveLength(2);

    await writeFile(join(dirname(currentPath), "011.txt"), "altered\n");
    await expect(
      observeReleaseOrdinal(currentPath, 2, {
        timeoutMs: 100,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/digest/);
  });
});

describe("fixture progressive Git work", () => {
  test("commits release-one analysis before revising it after release two", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository]);
    await execFileAsync("git", ["-C", repository, "config", "user.name", "Fixture Agent"]);
    await execFileAsync("git", [
      "-C",
      repository,
      "config",
      "user.email",
      "fixture@palimpsest.invalid",
    ]);
    await writeFile(join(repository, "README.md"), "genesis\n");
    await execFileAsync("git", ["-C", repository, "add", "README.md"]);
    await execFileAsync("git", ["-C", repository, "commit", "--quiet", "-m", "genesis"]);

    const currentPath = join(root, "released", "release-manifest.json");
    const firstChapter = { index: 10, bytes: Buffer.from("first\n") };
    const secondChapter = { index: 11, bytes: Buffer.from("second\n") };
    await writeRelease(currentPath, 1, [firstChapter]);
    const first = await observeReleaseOrdinal(currentPath, 1, {
      timeoutMs: 100,
      pollIntervalMs: 5,
    });
    const firstTip = await commitReleaseAnalysis({
      repository,
      agentId: "agent-1",
      observedReleases: [first],
    });

    await writeRelease(currentPath, 2, [firstChapter, secondChapter]);
    const second = await observeReleaseOrdinal(currentPath, 2, {
      timeoutMs: 100,
      pollIntervalMs: 5,
    });
    const revisedTip = await commitReleaseAnalysis({
      repository,
      agentId: "agent-1",
      observedReleases: [first, second],
    });

    const { stdout: history } = await execFileAsync("git", [
      "-C",
      repository,
      "log",
      "-2",
      "--format=%s",
    ]);
    const { stdout: initialNotes } = await execFileAsync("git", [
      "-C",
      repository,
      "show",
      `${firstTip}:notes/agent-1.md`,
    ]);
    const { stdout: revisedNotes } = await execFileAsync("git", [
      "-C",
      repository,
      "show",
      `${revisedTip}:notes/agent-1.md`,
    ]);

    expect(history.trim().split("\n")).toEqual([
      "agent-1 revise after second release",
      "agent-1 analyze first release",
    ]);
    expect(initialNotes).toContain("## Release 1");
    expect(initialNotes).not.toContain("## Release 2");
    expect(revisedNotes).toContain("## Release 1");
    expect(revisedNotes).toContain("## Release 2");
    expect(revisedNotes).toContain("Revised hypothesis");
  });
});
