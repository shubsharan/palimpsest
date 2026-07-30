import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createDockerCommandSandbox } from "../../src/sandbox/container.js";
import {
  SANDBOX_CONTAINER_LABEL,
  SANDBOX_IMAGE_TAG,
  SANDBOX_POLICY,
  SandboxInfrastructureError,
} from "../../src/sandbox/contracts.js";
import { sandboxDockerfileDigest } from "../../src/sandbox/docker.js";
import { resolveWorkspaceRegularFile } from "../../src/sandbox/workspace.js";
import { createGitEnvironment, listRemoteRefs, type GitCommunicationMode } from "../../src/git.js";
import type { AgentId } from "../../src/model.js";

const execFileAsync = promisify(execFile);
const originalApiKey = process.env.OPENAI_API_KEY;
const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function assertNoSandboxContainers(labelValue: string): Promise<void> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=${SANDBOX_CONTAINER_LABEL}=${labelValue}`,
  ]);
  expect(stdout.trim()).toBe("");
}

async function sandboxContainerCount(labelValue: string): Promise<number> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=${SANDBOX_CONTAINER_LABEL}=${labelValue}`,
  ]);
  return stdout.trim() === "" ? 0 : stdout.trim().split("\n").length;
}

async function agentFixture(communicationMode: GitCommunicationMode = "shared") {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-integration-"));
  const git = await createGitEnvironment(join(root, "git"), communicationMode, AGENT_IDS);
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

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

describe("real Docker command containment", () => {
  it("exposes only own inputs while retaining ordinary shared Git", async () => {
    const fixture = await agentFixture();
    process.env.OPENAI_API_KEY = "host-provider-secret";
    const sandbox = await createDockerCommandSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent",
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      referenceCorpusPath: fixture.reference,
      gitOriginPath: fixture.repository.path,
    });
    expect(sandbox.identity).toEqual({
      imageTag: SANDBOX_IMAGE_TAG,
      imageId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      sourceDigest: await sandboxDockerfileDigest(),
      profileVersion: 1,
    });
    const result = await lease.execute({
      command: [
        'test "$(cat /evidence/stage.txt)" = private-stage',
        'test "$(cat /reference/reference.txt)" = reference-corpus',
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
    const sandbox = await createDockerCommandSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent",
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      referenceCorpusPath: fixture.reference,
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

    expect(result.exitCode).toBe(0);
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
      createDockerCommandSandbox({ expectedImageId: `sha256:${"0".repeat(64)}` }),
    ).rejects.toThrow(SandboxInfrastructureError);
    expect(SANDBOX_POLICY).toEqual({
      network: "none",
      cpus: 2,
      memoryBytes: 2_147_483_648,
      pids: 256,
      tmpfsBytes: 268_435_456,
      maxOutputBytes: 4_194_304,
    });
  });

  it("gives evaluation only the ciphertext, frozen Git, and writable workspace", async () => {
    const fixture = await agentFixture();
    const ciphertext = join(fixture.root, "ciphertext.txt");
    await writeFile(ciphertext, "complete-ciphertext\n");
    const sandbox = await createDockerCommandSandbox();
    const result = await sandbox.execute({
      profile: "evaluation",
      command: [
        'test "$(cat "$PALIMPSEST_CIPHERTEXT")" = complete-ciphertext',
        "git fetch origin",
        'cp "$PALIMPSEST_CIPHERTEXT" "$PALIMPSEST_OUTPUT"',
        `test ! -e ${shellQuote(fixture.oracle)}`,
        `test ! -e ${shellQuote(fixture.hostSentinel)}`,
        'test -z "${OPENAI_API_KEY+x}"',
      ].join(" && "),
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      ciphertextPath: ciphertext,
      gitOriginPath: fixture.repository.path,
      outputPath: "reconstruction.txt",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(fixture.workspace, "reconstruction.txt"), "utf8")).toBe(
      "complete-ciphertext\n",
    );
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

  it("force-removes containers after failure, timeout, cancellation, and output overflow", async () => {
    const fixture = await agentFixture();
    const sandbox = await createDockerCommandSandbox();
    const lease = await sandbox.openAgentLease({
      profile: "agent" as const,
      timeoutMs: 30_000,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      referenceCorpusPath: fixture.reference,
      gitOriginPath: fixture.repository.path,
    });

    await expect(lease.execute({ command: "exit 7", timeoutMs: 10_000 })).resolves.toMatchObject({
      exitCode: 7,
    });
    expect(await sandboxContainerCount(sandbox.containerLabelValue)).toBe(1);

    await expect(lease.execute({ command: "sleep 5", timeoutMs: 30 })).resolves.toMatchObject({
      timedOut: true,
    });
    await assertNoSandboxContainers(sandbox.containerLabelValue);

    const controller = new AbortController();
    const cancelled = lease.execute({
      command: "sleep 5",
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await assertNoSandboxContainers(sandbox.containerLabelValue);

    await expect(
      lease.execute({
        command: `python3 -c "print('x' * 5000000)"`,
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({
      outputExceeded: true,
      stderr: expect.stringContaining("4 MiB"),
    });
    await assertNoSandboxContainers(sandbox.containerLabelValue);
    await lease.close();
  }, 30_000);
});
