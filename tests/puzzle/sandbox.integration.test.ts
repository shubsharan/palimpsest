import { execFile, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LABEL_TESTCONTAINERS_SESSION_ID,
  getContainerRuntimeClient,
  getReaper,
} from "testcontainers";

import { createDockerCommandSandbox } from "../../src/sandbox/container.js";
import {
  SANDBOX_CONTAINER_LABEL,
  SANDBOX_POLICY,
  SandboxInfrastructureError,
  sandboxImageTag,
  type SandboxContainerLabels,
} from "../../src/sandbox/contracts.js";
import {
  parseSandboxImageInspection,
  sandboxDockerfileDigest,
  validateSandboxImageInspection,
} from "../../src/sandbox/docker.js";
import { sandboxDockerBuildArguments } from "../../src/fixture/build.js";
import { resolveWorkspaceRegularFile } from "../../src/sandbox/workspace.js";
import { createGitEnvironment, listRemoteRefs, type GitCommunicationMode } from "../../src/git.js";
import type { AgentId } from "../../src/model/contracts.js";
import {
  executePublishedSolver,
  PUBLISHED_MAIN_REF,
} from "../../src/evaluation/published-solver.js";

const execFileAsync = promisify(execFile);
const originalApiKey = process.env.OPENAI_API_KEY;
const AGENTS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];
const temporaryRoots: string[] = [];
let testcontainerLabels: SandboxContainerLabels;

async function dockerResourceDiagnostic(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--all",
        "--filter",
        `label=${SANDBOX_CONTAINER_LABEL}`,
        "--format",
        "{{.Names}} {{.Status}}",
      ],
      { timeout: 2_000 },
    );
    const containers = stdout.trim();
    return containers === "" ? "" : ` Active Palimpsest containers:\n${containers}`;
  } catch {
    return " Docker container diagnostics were also unavailable.";
  }
}

beforeAll(async () => {
  let timer: NodeJS.Timeout | undefined;
  const startup = getReaper(await getContainerRuntimeClient());
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void dockerResourceDiagnostic().then((diagnostic) => {
        reject(
          new Error(`Testcontainers resource reaper did not start within 8 seconds.${diagnostic}`),
        );
      });
    }, 8_000);
  });
  try {
    const reaper = await Promise.race([startup, timeout]);
    testcontainerLabels = { [LABEL_TESTCONTAINERS_SESSION_ID]: reaper.sessionId };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}, 12_000);

function createTestSandbox(options: { expectedImageId?: string } = {}) {
  return createDockerCommandSandbox({
    ...options,
    containerLabels: testcontainerLabels,
    inspectionTimeoutMs: 5_000,
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function assertNoSandboxContainers(labelValue: string): Promise<void> {
  const { stdout } = await execFileAsync(
    "docker",
    ["ps", "--all", "--quiet", "--filter", `label=${SANDBOX_CONTAINER_LABEL}=${labelValue}`],
    { timeout: 5_000 },
  );
  expect(stdout.trim()).toBe("");
}

async function sandboxContainerCount(labelValue: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "docker",
    ["ps", "--all", "--quiet", "--filter", `label=${SANDBOX_CONTAINER_LABEL}=${labelValue}`],
    { timeout: 5_000 },
  );
  return stdout.trim() === "" ? 0 : stdout.trim().split("\n").length;
}

async function waitForSessionCleanup(sessionId: string): Promise<void> {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `label=${LABEL_TESTCONTAINERS_SESSION_ID}=${sessionId}`,
      ],
      { timeout: 5_000 },
    );
    if (stdout.trim() === "") return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Testcontainers did not reap session ${sessionId} within 15 seconds.`);
}

async function agentFixture(communicationMode: GitCommunicationMode = "shared") {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-integration-"));
  temporaryRoots.push(root);
  const git = await createGitEnvironment(join(root, "git"), communicationMode, AGENTS);
  const workspace = git.workspaces[0];
  if (!workspace) throw new Error("Expected agent-1 workspace.");
  const repository = git.repositories.find(
    (candidate) => candidate.repositoryId === workspace.repositoryId,
  );
  if (!repository) throw new Error("Expected agent-1 repository assignment.");
  const evidence = join(root, "evidence");
  const peerEvidence = join(root, "peer-evidence");
  const oracle = join(root, "oracle");
  const reference = join(root, "reference");
  const hostSentinel = join(root, "host-sentinel.txt");
  await Promise.all([mkdir(evidence), mkdir(peerEvidence), mkdir(oracle), mkdir(reference)]);
  await Promise.all([
    writeFile(join(evidence, "stage.txt"), "private-stage\n"),
    writeFile(join(peerEvidence, "stage.txt"), "peer-secret\n"),
    writeFile(join(oracle, "plaintext.txt"), "oracle-secret\n"),
    writeFile(join(reference, "reference.txt"), "reference-corpus\n"),
    writeFile(hostSentinel, "host-secret\n"),
  ]);
  return {
    root,
    git,
    repository,
    workspace: workspace.path,
    evidence,
    peerEvidence,
    oracle,
    reference,
    hostSentinel,
  };
}

afterEach(async () => {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("real Docker command containment", () => {
  it("exposes only own inputs while retaining ordinary shared Git", async () => {
    const fixture = await agentFixture();
    process.env.OPENAI_API_KEY = "host-provider-secret";
    const sandbox = await createTestSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent",
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      gitOriginPath: fixture.repository.path,
    });
    expect(sandbox.identity).toEqual({
      imageTag: sandboxImageTag(await sandboxDockerfileDigest()),
      imageId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      sourceDigest: await sandboxDockerfileDigest(),
      profileVersion: 1,
    });
    const result = await lease.execute({
      command: [
        'test "$(cat /evidence/stage.txt)" = private-stage',
        "test ! -e /reference",
        `test ! -e ${shellQuote(fixture.peerEvidence)}`,
        `test ! -e ${shellQuote(fixture.oracle)}`,
        `test ! -e ${shellQuote(fixture.hostSentinel)}`,
        'test -z "${OPENAI_API_KEY+x}"',
        `python3 -c 'import socket, sys; sock = socket.socket(); sock.settimeout(0.2); sys.exit(0 if sock.connect_ex(("1.1.1.1", 53)) != 0 else 1)'`,
        "printf 'shared\\n' > shared.txt",
        "git add shared.txt",
        "git commit -m 'share result'",
        "git push origin HEAD:refs/heads/team/result",
      ].join(" && "),
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      outputExceeded: false,
    });
    expect(await listRemoteRefs(fixture.repository.path)).toHaveProperty("refs/heads/team/result");
    expect(await sandboxContainerCount(sandbox.containerLabelValue)).toBe(1);
    await lease.close();
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("mounts only an isolated agent's assigned origin", async () => {
    const fixture = await agentFixture("isolated");
    const peerRepositories = fixture.git.repositories.filter(
      (repository) => repository.repositoryId !== fixture.repository.repositoryId,
    );
    const sandbox = await createTestSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent",
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      gitOriginPath: fixture.repository.path,
    });
    const result = await lease.execute({
      command: [
        'test "$(git remote get-url origin)" = /git/origin.git',
        "printf 'private\\n' > private.txt",
        "git add private.txt",
        "git commit -m 'record private result'",
        "git push origin HEAD:refs/heads/private/result",
      ].join(" && "),
      timeoutMs: 30_000,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await listRemoteRefs(fixture.repository.path)).toHaveProperty(
      "refs/heads/private/result",
    );
    const scaffoldCommit = (await listRemoteRefs(fixture.repository.path))["refs/heads/main"];
    for (const repository of peerRepositories) {
      expect(await listRemoteRefs(repository.path)).toEqual({
        "refs/heads/main": scaffoldCommit,
      });
    }
    await lease.close();
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("rejects escaped workspace paths and an evaluation image mismatch before execution", async () => {
    const fixture = await agentFixture();
    const outside = join(fixture.root, "outside.txt");
    const link = join(fixture.workspace, "escaped.txt");
    await writeFile(outside, "outside\n");
    await symlink(outside, link);

    await expect(
      resolveWorkspaceRegularFile(fixture.workspace, "../outside.txt", "Candidate"),
    ).rejects.toMatchObject({ name: "WorkspaceFileError", failure: "outside" });
    await expect(
      resolveWorkspaceRegularFile(fixture.workspace, "escaped.txt", "Candidate"),
    ).rejects.toMatchObject({ name: "WorkspaceFileError", failure: "outside" });

    await expect(
      createTestSandbox({ expectedImageId: `sha256:${"0".repeat(64)}` }),
    ).rejects.toThrow(SandboxInfrastructureError);
    expect(SANDBOX_POLICY).toEqual({
      network: "none",
      cpus: 2,
      memoryBytes: 2_147_483_648,
      pids: 256,
      tmpfsBytes: 268_435_456,
      solverOutputBytes: 16_777_216,
      maxOutputBytes: 4_194_304,
    });
  });

  it("keeps independently built source digests addressable by runnable image identity", async () => {
    const nonce = randomUUID();
    const digests = ["first", "second"].map((name) =>
      createHash("sha256").update(`${name}-${nonce}`).digest("hex"),
    );
    const tags = digests.map(sandboxImageTag);
    const containerNames = digests.map(
      (_digest, index) => `palimpsest-image-identity-${String(index)}-${randomUUID()}`,
    );
    const imageIds: string[] = [];
    try {
      for (const [index, digest] of digests.entries()) {
        await execFileAsync("docker", [...sandboxDockerBuildArguments(digest!)], {
          cwd: process.cwd(),
          maxBuffer: 10 * 1_024 * 1_024,
          timeout: 120_000,
        });
        const { stdout } = await execFileAsync("docker", ["image", "inspect", tags[index]!], {
          timeout: 5_000,
        });
        const identity = validateSandboxImageInspection(
          parseSandboxImageInspection(stdout),
          digest!,
        );
        imageIds.push(identity.imageId);
        await execFileAsync(
          "docker",
          [
            "create",
            "--name",
            containerNames[index]!,
            "--label",
            `${LABEL_TESTCONTAINERS_SESSION_ID}=${testcontainerLabels[LABEL_TESTCONTAINERS_SESSION_ID]!}`,
            identity.imageId,
            "/bin/true",
          ],
          { timeout: 10_000 },
        );
      }
      expect(new Set(tags).size).toBe(2);
      expect(new Set(imageIds).size).toBe(2);
    } finally {
      await Promise.allSettled(
        containerNames.map((name) =>
          execFileAsync("docker", ["rm", "--force", name], { timeout: 5_000 }),
        ),
      );
      await Promise.allSettled(
        tags.map((tag) => execFileAsync("docker", ["image", "rm", tag], { timeout: 5_000 })),
      );
    }
  }, 60_000);

  it("gives solver execution only read-only inputs and bounded output scratch", async () => {
    const fixture = await agentFixture();
    const ciphertext = join(fixture.root, "ciphertext.txt");
    const submission = join(fixture.root, "submission");
    const output = join(fixture.root, "output");
    await Promise.all([
      writeFile(ciphertext, "complete-ciphertext\n"),
      mkdir(submission),
      mkdir(output),
    ]);
    const sandbox = await createTestSandbox();
    const result = await sandbox.execute({
      profile: "solver",
      command: [
        'test "$(cat "$PALIMPSEST_CIPHERTEXT")" = complete-ciphertext',
        'cp "$PALIMPSEST_CIPHERTEXT" "$PALIMPSEST_OUTPUT"',
        "test ! -e .git",
        "test ! -e /git/origin.git/HEAD",
        "test ! -e /evidence/stage.txt",
        "test ! -e /reference/reference.txt",
        `test ! -e ${shellQuote(fixture.oracle)}`,
        `test ! -e ${shellQuote(fixture.hostSentinel)}`,
        'test -z "${OPENAI_API_KEY+x}"',
      ].join(" && "),
      timeoutMs: 30_000,
      submissionPath: submission,
      ciphertextPath: ciphertext,
      outputRoot: output,
      outputPath: "reconstruction.txt",
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readFile(join(output, "reconstruction.txt"), "utf8")).toBe(
      "complete-ciphertext\n",
    );
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("executes a Git-free replay checkpoint in the real solver sandbox", async () => {
    const fixture = await agentFixture();
    const ciphertext = join(fixture.root, "replay-ciphertext.txt");
    const submission = join(fixture.root, "replay-checkpoint");
    const output = join(fixture.root, "replay-output");
    await Promise.all([mkdir(submission), mkdir(output), writeFile(ciphertext, "cipher word\n")]);
    await writeFile(
      join(submission, "solver.py"),
      [
        "import os",
        "from pathlib import Path",
        "source = Path(os.environ['PALIMPSEST_CIPHERTEXT'])",
        "target = Path(os.environ['PALIMPSEST_OUTPUT'])",
        "target.write_text(source.read_text().replace('cipher', 'plain'))",
        "",
      ].join("\n"),
    );

    const sandbox = await createTestSandbox();
    const result = await executePublishedSolver({
      snapshot: {
        ref: PUBLISHED_MAIN_REF,
        commit: "a".repeat(40),
        snapshotPath: submission,
      },
      ciphertextPath: ciphertext,
      outputRoot: output,
      sandbox,
    });

    expect(result).toMatchObject({ kind: "succeeded" });
    expect(await readFile(join(output, "reconstruction.txt"), "utf8")).toBe("plain word\n");
    await expect(readFile(join(submission, ".git"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("bounds streaming solver output before it reaches host storage", async () => {
    const fixture = await agentFixture();
    const ciphertext = join(fixture.root, "ciphertext.txt");
    const submission = join(fixture.root, "submission");
    const output = join(fixture.root, "output");
    await Promise.all([writeFile(ciphertext, "ciphertext\n"), mkdir(submission), mkdir(output)]);
    const sandbox = await createTestSandbox();

    const result = await sandbox.execute({
      profile: "solver",
      command:
        'python3 -c \'import os; f=open(os.environ["PALIMPSEST_OUTPUT"], "wb"); ' +
        'chunk=b"x"*1048576\nwhile True: f.write(chunk); f.flush()\'',
      timeoutMs: 30_000,
      submissionPath: submission,
      ciphertextPath: ciphertext,
      outputRoot: output,
      outputPath: "reconstruction.txt",
    });

    expect(result.exitCode).not.toBe(0);
    expect(await readdir(output)).toEqual([]);
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("force-removes containers after failure, timeout, cancellation, and output overflow", async () => {
    const fixture = await agentFixture();
    const sandbox = await createTestSandbox();
    const openLease = () =>
      sandbox.openAgentLease({
        profile: "agent" as const,
        timeoutMs: 10_000,
        workspacePath: fixture.workspace,
        evidencePath: fixture.evidence,
        gitOriginPath: fixture.repository.path,
      });

    const failedLease = await openLease();
    await expect(
      failedLease.execute({ command: "exit 7", timeoutMs: 10_000 }),
    ).resolves.toMatchObject({ exitCode: 7 });
    expect(await sandboxContainerCount(sandbox.containerLabelValue)).toBe(1);
    await failedLease.close();

    const timedOutLease = await openLease();
    await expect(
      timedOutLease.execute({ command: "sleep 5", timeoutMs: 30 }),
    ).resolves.toMatchObject({
      timedOut: true,
    });
    await expect(timedOutLease.execute({ command: "true", timeoutMs: 1_000 })).rejects.toThrow(
      "Agent sandbox lease is unusable",
    );
    await assertNoSandboxContainers(sandbox.containerLabelValue);
    await timedOutLease.close();

    const cancelledLease = await openLease();
    const controller = new AbortController();
    const cancelled = cancelledLease.execute({
      command: "sleep 5",
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await assertNoSandboxContainers(sandbox.containerLabelValue);
    await cancelledLease.close();

    const overflowLease = await openLease();
    await expect(
      overflowLease.execute({
        command: `python3 -c "print('x' * 5000000)"`,
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({
      outputExceeded: true,
      stderr: expect.stringContaining("4 MiB"),
    });
    await assertNoSandboxContainers(sandbox.containerLabelValue);
    await overflowLease.close();
  }, 30_000);

  it("reaps an abruptly terminated test session without touching another controller", async () => {
    const fixture = await agentFixture();
    const sandbox = await createTestSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent",
      timeoutMs: 10_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      gitOriginPath: fixture.repository.path,
    });
    const child = fork(join(process.cwd(), "tests/support/docker-reaper-child.ts"), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let childDiagnostic = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      childDiagnostic += chunk.toString("utf8");
    });
    const childReady = new Promise<{ controllerId: string; root: string; sessionId: string }>(
      (resolveReady, rejectReady) => {
        child.once("message", (message: unknown) => {
          if (
            typeof message !== "object" ||
            message === null ||
            !("controllerId" in message) ||
            !("root" in message) ||
            !("sessionId" in message)
          ) {
            rejectReady(new Error("Docker reaper child returned an invalid ready message."));
            return;
          }
          resolveReady(message as { controllerId: string; root: string; sessionId: string });
        });
        child.once("exit", (code, signal) => {
          rejectReady(
            new Error(
              `Docker reaper child exited before ready (${String(code ?? signal)}): ${childDiagnostic}`,
            ),
          );
        });
      },
    );
    let childSession: { controllerId: string; root: string; sessionId: string } | undefined;
    try {
      childSession = await childReady;
      expect(await sandboxContainerCount(childSession.controllerId)).toBe(1);
      const childExit = once(child, "exit");
      child.kill("SIGKILL");
      await childExit;
      await waitForSessionCleanup(childSession.sessionId);
      expect(await sandboxContainerCount(sandbox.containerLabelValue)).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const childExit = once(child, "exit");
        child.kill("SIGKILL");
        await childExit;
      }
      await lease.close();
      if (childSession !== undefined) {
        await rm(childSession.root, { force: true, recursive: true });
      }
    }
  }, 45_000);
});
