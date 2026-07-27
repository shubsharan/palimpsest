import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDockerCreateArguments,
  SANDBOX_CONTAINER_LABEL,
  SANDBOX_POLICY,
  SANDBOX_PROFILE_LABEL,
  SANDBOX_SOURCE_LABEL,
  SandboxInfrastructureError,
  validateSandboxImageInspection,
} from "../src/sandbox.js";
import { TEST_SANDBOX_IDENTITY } from "./helpers.js";

describe("command sandbox contract", () => {
  it("validates the source-labelled immutable image identity", () => {
    const inspection = {
      Id: TEST_SANDBOX_IDENTITY.imageId,
      Config: {
        Labels: {
          [SANDBOX_PROFILE_LABEL]: "1",
          [SANDBOX_SOURCE_LABEL]: TEST_SANDBOX_IDENTITY.sourceDigest,
        },
      },
    };
    expect(
      validateSandboxImageInspection(
        inspection,
        TEST_SANDBOX_IDENTITY.sourceDigest,
        TEST_SANDBOX_IDENTITY.imageId,
      ),
    ).toEqual(TEST_SANDBOX_IDENTITY);
    expect(() =>
      validateSandboxImageInspection(inspection, "stale", TEST_SANDBOX_IDENTITY.imageId),
    ).toThrow(SandboxInfrastructureError);
  });

  it("constructs the fixed agent policy, allowlisted environment, and mounts", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-args-"));
    const workspace = join(root, "workspace");
    const evidence = join(root, "evidence");
    const sharedGit = join(root, "shared.git");
    const reference = join(root, "reference");
    await Promise.all([mkdir(workspace), mkdir(evidence), mkdir(sharedGit), mkdir(reference)]);
    await writeFile(join(reference, "reference.txt"), "reference\n");
    const args = await buildDockerCreateArguments(
      {
        profile: "agent",
        command: "git status",
        timeoutMs: 1_000,
        workspacePath: workspace,
        evidencePath: evidence,
        referenceCorpusPath: reference,
        sharedGitPath: sharedGit,
      },
      TEST_SANDBOX_IDENTITY,
      "palimpsest-agent-test",
      { uid: 501, gid: 20 },
    );
    const joined = args.join("\n");

    expect(args.slice(0, 3)).toEqual(["create", "--name", "palimpsest-agent-test"]);
    expect(joined).toContain(`${SANDBOX_CONTAINER_LABEL}=1`);
    expect(joined).toContain("--read-only");
    expect(joined).toContain("none");
    expect(joined).toContain(String(SANDBOX_POLICY.memoryBytes));
    expect(joined).toContain(String(SANDBOX_POLICY.pids));
    expect(joined).toContain("target=/workspace");
    expect(joined).toContain("target=/evidence,readonly");
    expect(joined).toContain("target=/reference,readonly");
    expect(joined).toContain("target=/git/shared.git");
    expect(joined).not.toContain("target=/git/shared.git,readonly");
    expect(joined).toContain("HOME=/workspace");
    expect(joined).not.toMatch(/OPENAI_API_KEY|process\.env/);
    expect(args.at(-1)).toBe("git status");
  });

  it("gives evaluation only ciphertext, frozen Git, and a workspace-relative output", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-evaluation-args-"));
    const workspace = join(root, "workspace");
    const frozenGit = join(root, "shared.git");
    const ciphertext = join(root, "ciphertext.txt");
    await Promise.all([mkdir(workspace), mkdir(frozenGit), writeFile(ciphertext, "ciphertext\n")]);
    const args = await buildDockerCreateArguments(
      {
        profile: "evaluation",
        command: "sh solve.sh",
        timeoutMs: 1_000,
        workspacePath: workspace,
        ciphertextPath: ciphertext,
        frozenGitPath: frozenGit,
        outputPath: "out/answer.txt",
      },
      TEST_SANDBOX_IDENTITY,
      "palimpsest-evaluation-test",
      { uid: 501, gid: 20 },
    );
    const joined = args.join("\n");

    expect(joined).toContain("target=/input/ciphertext.txt,readonly");
    expect(joined).toContain("target=/git/shared.git,readonly");
    expect(joined).toContain("PALIMPSEST_CIPHERTEXT=/input/ciphertext.txt");
    expect(joined).toContain("PALIMPSEST_OUTPUT=/workspace/out/answer.txt");
    expect(joined).not.toContain("/evidence");
    expect(joined).not.toContain("/reference");
  });
});
