import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SANDBOX_CONTAINER_LABEL,
  SANDBOX_POLICY,
  SANDBOX_PROFILE_LABEL,
  SANDBOX_SOURCE_LABEL,
  SandboxInfrastructureError,
  type SandboxIdentity,
} from "./contracts.js";
import {
  buildAgentDockerCreateArguments,
  buildDockerCreateArguments,
  buildDockerExecArguments,
  validateSandboxImageInspection,
} from "./docker.js";

const TEST_IDENTITY: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"1".repeat(64)}`,
  sourceDigest: "2".repeat(64),
  profileVersion: 1,
};
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-docker-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("sandbox Docker image and arguments", () => {
  it("validates the source-labelled immutable image identity", () => {
    const inspection = {
      Id: TEST_IDENTITY.imageId,
      Config: {
        Labels: {
          [SANDBOX_PROFILE_LABEL]: "1",
          [SANDBOX_SOURCE_LABEL]: TEST_IDENTITY.sourceDigest,
        },
      },
    };

    expect(
      validateSandboxImageInspection(inspection, TEST_IDENTITY.sourceDigest, TEST_IDENTITY.imageId),
    ).toEqual(TEST_IDENTITY);
    expect(() =>
      validateSandboxImageInspection(inspection, "stale", TEST_IDENTITY.imageId),
    ).toThrow(SandboxInfrastructureError);
    expect(() =>
      validateSandboxImageInspection(
        inspection,
        TEST_IDENTITY.sourceDigest,
        `sha256:${"3".repeat(64)}`,
      ),
    ).toThrow(/attempt-recorded image ID/);
  });

  it("constructs the fixed agent policy, allowlisted environment, and mounts", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const evidence = join(root, "evidence");
    const gitOrigin = join(root, "agent-1.git");
    const peerGitOrigin = join(root, "agent-2.git");
    const reference = join(root, "reference");
    await Promise.all([
      mkdir(workspace),
      mkdir(evidence),
      mkdir(gitOrigin),
      mkdir(peerGitOrigin),
      mkdir(reference),
    ]);
    const args = await buildAgentDockerCreateArguments(
      {
        profile: "agent",
        timeoutMs: 1_000,
        workspacePath: workspace,
        evidencePath: evidence,
        referenceCorpusPath: reference,
        gitOriginPath: gitOrigin,
      },
      TEST_IDENTITY,
      "palimpsest-agent-test",
      { uid: 501, gid: 20 },
    );
    const joined = args.join("\n");
    const resolvedGitOrigin = await realpath(gitOrigin);
    const resolvedPeerGitOrigin = await realpath(peerGitOrigin);
    const environmentStart = args.indexOf("-i") + 1;
    const shellIndex = args.indexOf("/bin/sh");

    expect(args.slice(0, 3)).toEqual(["create", "--name", "palimpsest-agent-test"]);
    expect(joined).toContain(`${SANDBOX_CONTAINER_LABEL}=1`);
    expect(joined).toContain("--read-only");
    expect(joined).toContain("none");
    expect(joined).toContain(String(SANDBOX_POLICY.memoryBytes));
    expect(joined).toContain(String(SANDBOX_POLICY.pids));
    expect(joined).toContain("target=/workspace");
    expect(joined).toContain("target=/evidence,readonly");
    expect(joined).toContain("target=/reference,readonly");
    expect(joined).toContain(`source=${resolvedGitOrigin},target=/git/origin.git`);
    expect(joined.match(/target=\/git\/origin\.git/g)).toHaveLength(1);
    expect(joined).not.toContain(resolvedPeerGitOrigin);
    expect(joined).not.toContain("target=/git/origin.git,readonly");
    expect(args.slice(environmentStart, shellIndex)).toEqual([
      "HOME=/workspace",
      "LANG=C.UTF-8",
      "LC_ALL=C.UTF-8",
      "TMPDIR=/tmp",
      "GIT_TERMINAL_PROMPT=0",
    ]);
    expect(joined).not.toMatch(/OPENAI_API_KEY|process\.env/);
    expect(args.at(-1)).toBe("while :; do sleep 3600; done");

    const execArgs = buildDockerExecArguments(
      { command: "git status", timeoutMs: 1_000 },
      "palimpsest-agent-test",
      { uid: 501, gid: 20 },
    );
    expect(execArgs.slice(0, 2)).toEqual(["exec", "--workdir"]);
    expect(execArgs.at(-1)).toBe("git status");
  });

  it("gives evaluation only ciphertext, frozen Git, and a contained output path", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const frozenGit = join(root, "agent-1.git");
    const ciphertext = join(root, "ciphertext.txt");
    await Promise.all([mkdir(workspace), mkdir(frozenGit), writeFile(ciphertext, "ciphertext\n")]);
    const args = await buildDockerCreateArguments(
      {
        profile: "evaluation",
        command: "sh solve.sh",
        timeoutMs: 1_000,
        workspacePath: workspace,
        ciphertextPath: ciphertext,
        gitOriginPath: frozenGit,
        outputPath: "out/answer.txt",
      },
      TEST_IDENTITY,
      "palimpsest-evaluation-test",
      { uid: 501, gid: 20 },
    );
    const joined = args.join("\n");
    const resolvedFrozenGit = await realpath(frozenGit);

    expect(joined).toContain("target=/input/ciphertext.txt,readonly");
    expect(joined).toContain(`source=${resolvedFrozenGit},target=/git/origin.git,readonly`);
    expect(joined.match(/target=\/git\/origin\.git/g)).toHaveLength(1);
    expect(joined).toContain("PALIMPSEST_CIPHERTEXT=/input/ciphertext.txt");
    expect(joined).toContain("PALIMPSEST_OUTPUT=/workspace/out/answer.txt");
    expect(joined).not.toContain("/evidence");
    expect(joined).not.toContain("/reference");
  });
});
