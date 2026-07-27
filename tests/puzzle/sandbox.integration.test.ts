import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDockerCommandSandbox,
  SANDBOX_CONTAINER_LABEL,
} from "../../packages/puzzle-runner/src/sandbox.js";
import { createGitEnvironment, listRemoteRefs } from "../../packages/puzzle-runner/src/git.js";

const execFileAsync = promisify(execFile);
const originalApiKey = process.env.OPENAI_API_KEY;

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

async function agentFixture() {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-integration-"));
  const git = await createGitEnvironment(join(root, "git"));
  const workspace = git.workspaces[0];
  if (!workspace) throw new Error("Expected agent-1 workspace.");
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
    const result = await sandbox.execute({
      profile: "agent",
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
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      referenceCorpusPath: fixture.reference,
      sharedGitPath: fixture.git.barePath,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      outputExceeded: false,
    });
    expect(await listRemoteRefs(fixture.git.barePath)).toHaveProperty("refs/heads/team/result");
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 60_000);

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
      frozenGitPath: fixture.git.barePath,
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
    const base = {
      profile: "agent" as const,
      workspacePath: fixture.workspace,
      evidencePath: fixture.evidence,
      referenceCorpusPath: fixture.reference,
      sharedGitPath: fixture.git.barePath,
    };

    await expect(
      sandbox.execute({ ...base, command: "exit 7", timeoutMs: 10_000 }),
    ).resolves.toMatchObject({ exitCode: 7 });
    await assertNoSandboxContainers(sandbox.containerLabelValue);

    await expect(
      sandbox.execute({ ...base, command: "sleep 5", timeoutMs: 30 }),
    ).resolves.toMatchObject({ timedOut: true });
    await assertNoSandboxContainers(sandbox.containerLabelValue);

    const controller = new AbortController();
    const cancelled = sandbox.execute({
      ...base,
      command: "sleep 5",
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await assertNoSandboxContainers(sandbox.containerLabelValue);

    await expect(
      sandbox.execute({
        ...base,
        command: `python3 -c "print('x' * 5000000)"`,
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({
      outputExceeded: true,
      stderr: expect.stringContaining("4 MiB"),
    });
    await assertNoSandboxContainers(sandbox.containerLabelValue);
  }, 30_000);
});
