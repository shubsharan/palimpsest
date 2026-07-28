import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertPreflightSandbox,
  decodePreflightReceipt,
  preflightReceiptPath,
  publishPreflightReceipt,
  readCurrentPreflight,
  readSourceState,
  runPreflight,
  type PreflightDependencies,
  type PreflightReceipt,
} from "./preflight.js";
import type { SandboxIdentity } from "./sandbox/contracts.js";

const execFileAsync = promisify(execFile);
const commit = "a".repeat(40);
const sandbox: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"b".repeat(64)}`,
  sourceDigest: "c".repeat(64),
  profileVersion: 1,
};

function receipt(overrides: Partial<PreflightReceipt> = {}): PreflightReceipt {
  return {
    schemaVersion: 1,
    testedCommit: commit,
    sourceClean: true,
    completedAt: "2026-07-28T12:00:00.000Z",
    sandbox,
    ...overrides,
  };
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  return result.stdout.trim();
}

async function gitFixture(): Promise<{ root: string; testedCommit: string }> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-preflight-git-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Preflight Test");
  await git(root, "config", "user.email", "preflight@example.invalid");
  await writeFile(join(root, ".gitignore"), "artifacts/\n", "utf8");
  await writeFile(join(root, "tracked.txt"), "clean\n", "utf8");
  await git(root, "add", ".gitignore", "tracked.txt");
  await git(root, "commit", "-q", "-m", "fixture");
  return { root, testedCommit: await git(root, "rev-parse", "HEAD") };
}

function dependencies(overrides: Partial<PreflightDependencies> = {}): PreflightDependencies {
  return {
    buildSandbox: async () => sandbox,
    runVerification: async () => undefined,
    runFixture: async () => ({ status: "scored", sandbox }),
    inspectSandbox: async () => sandbox,
    now: () => new Date("2026-07-28T12:00:00.000Z"),
    ...overrides,
  };
}

describe("research preflight", () => {
  it("strictly decodes one clean commit and immutable sandbox identity", () => {
    expect(decodePreflightReceipt(receipt())).toEqual(receipt());
    for (const invalid of [
      { ...receipt(), schemaVersion: 2 },
      { ...receipt(), testedCommit: "HEAD" },
      { ...receipt(), sourceClean: false },
      { ...receipt(), completedAt: "today" },
      { ...receipt(), sandbox: { ...sandbox, imageId: "latest" } },
      { ...receipt(), sandbox: { ...sandbox, sourceDigest: "bad" } },
      { ...receipt(), sandbox: { ...sandbox, profileVersion: 2 } },
    ]) {
      expect(() => decodePreflightReceipt(invalid)).toThrow();
    }
  });

  it("reads a detached clean commit and detects tracked or untracked drift", async () => {
    const fixture = await gitFixture();
    await git(fixture.root, "checkout", "-q", "--detach");
    await expect(readSourceState(fixture.root)).resolves.toEqual({
      testedCommit: fixture.testedCommit,
      sourceClean: true,
    });

    await writeFile(join(fixture.root, "tracked.txt"), "dirty\n", "utf8");
    await expect(readSourceState(fixture.root)).resolves.toMatchObject({ sourceClean: false });

    await git(fixture.root, "restore", "tracked.txt");
    await writeFile(join(fixture.root, "untracked.txt"), "dirty\n", "utf8");
    await expect(readSourceState(fixture.root)).resolves.toMatchObject({ sourceClean: false });
  });

  it("loads only a receipt matching the current clean commit", async () => {
    const fixture = await gitFixture();
    const current = receipt({ testedCommit: fixture.testedCommit });
    await publishPreflightReceipt(preflightReceiptPath(fixture.root), current);
    await expect(readCurrentPreflight(fixture.root)).resolves.toEqual(current);

    await writeFile(join(fixture.root, "untracked.txt"), "dirty\n", "utf8");
    await expect(readCurrentPreflight(fixture.root)).rejects.toThrow(/clean/i);
  });

  it("rejects a receipt for a different commit", async () => {
    const fixture = await gitFixture();
    await publishPreflightReceipt(preflightReceiptPath(fixture.root), receipt());
    await expect(readCurrentPreflight(fixture.root)).rejects.toThrow(
      /does not match current commit/i,
    );
  });

  it("rejects any sandbox identity drift", () => {
    expect(() => assertPreflightSandbox(receipt(), sandbox)).not.toThrow();
    expect(() =>
      assertPreflightSandbox(receipt(), {
        ...sandbox,
        imageId: `sha256:${"d".repeat(64)}`,
      }),
    ).toThrow(/sandbox/i);
  });

  it("publishes one receipt only after the full sequence succeeds", async () => {
    const fixture = await gitFixture();
    const calls: string[] = [];
    let fixtureTemporaryRoot = "";
    const result = await runPreflight(
      fixture.root,
      dependencies({
        buildSandbox: async () => {
          calls.push("build");
          return sandbox;
        },
        runVerification: async () => {
          calls.push("verify");
        },
        runFixture: async (_root, output) => {
          calls.push("fixture");
          fixtureTemporaryRoot = join(output, "..");
          const frozen = join(output, "attempt", "frozen", "workspaces");
          await mkdir(frozen, { recursive: true });
          await writeFile(join(frozen, "result.txt"), "read only\n", "utf8");
          await chmod(join(frozen, "result.txt"), 0o444);
          await chmod(frozen, 0o555);
          return { status: "scored", sandbox };
        },
        inspectSandbox: async () => {
          calls.push("inspect");
          return sandbox;
        },
      }),
    );

    expect(calls).toEqual(["build", "verify", "fixture", "inspect"]);
    expect(result).toEqual(
      receipt({
        testedCommit: fixture.testedCommit,
      }),
    );
    expect(
      decodePreflightReceipt(
        JSON.parse(await readFile(preflightReceiptPath(fixture.root), "utf8")),
      ),
    ).toEqual(result);
    await expect(access(fixtureTemporaryRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    [
      "verification failure",
      dependencies({
        runVerification: async () => {
          throw new Error("verification failed");
        },
      }),
    ],
    [
      "unscored fixture",
      dependencies({ runFixture: async () => ({ status: "execution-error", sandbox }) }),
    ],
    [
      "fixture sandbox mismatch",
      dependencies({
        runFixture: async () => ({
          status: "scored",
          sandbox: { ...sandbox, sourceDigest: "d".repeat(64) },
        }),
      }),
    ],
  ])("removes stale authorization after %s", async (_name, injected) => {
    const fixture = await gitFixture();
    await publishPreflightReceipt(
      preflightReceiptPath(fixture.root),
      receipt({ testedCommit: fixture.testedCommit }),
    );
    await expect(runPreflight(fixture.root, injected)).rejects.toThrow();
    await expect(access(preflightReceiptPath(fixture.root))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects source drift introduced during verification and leaves no receipt", async () => {
    const fixture = await gitFixture();
    await expect(
      runPreflight(
        fixture.root,
        dependencies({
          runVerification: async () => {
            await writeFile(join(fixture.root, "drift.txt"), "dirty\n", "utf8");
          },
        }),
      ),
    ).rejects.toThrow(/clean/i);
    await expect(access(preflightReceiptPath(fixture.root))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
