import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import {
  ACCOUNTING_VERSION,
  buildLogicalTransaction,
  GIT_SHA256_OBJECT_FORMAT,
  refOperations,
  VisibilityJournal,
} from "@palimpsest/git-accounting";

import {
  assertFramePolicy,
  assertAuthorizedRef,
  assertSafeCapability,
  assertSafeRepositoryPath,
  validateQuarantinedFrame,
} from "../src/policy.js";

const execFileAsync = promisify(execFile);

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args]);
  return stdout.trim();
}

describe("Git Gateway policy", () => {
  test("binds authenticated agents to their namespace", () => {
    const agent = {
      agentId: "agent-1",
      refNamespace: "refs/heads/agents/agent-1" as const,
    };
    expect(() => assertAuthorizedRef(agent, "refs/heads/agents/agent-1/work")).not.toThrow();
    expect(() => assertAuthorizedRef(agent, "refs/heads/agents/agent-2/work")).toThrow(
      /cannot update/,
    );
    expect(() => assertAuthorizedRef(agent, "refs/heads/main")).toThrow(/cannot update/);
  });

  test("allows only the frozen smart-protocol capability set", () => {
    expect(() => assertSafeCapability("object-format=sha256")).not.toThrow();
    expect(() => assertSafeCapability("agent=git/2.48.1")).not.toThrow();
    expect(() => assertSafeCapability("delete-refs")).toThrow(/not permitted/);
    expect(() => assertSafeCapability("push-options")).toThrow(/not permitted/);
  });

  test("rejects unsafe repository paths and mismatched authenticated senders", () => {
    expect(() => assertSafeRepositoryPath("notes/agent-1.md")).not.toThrow();
    for (const path of ["../oracle.txt", ".git/config", "A/../b", "a\\.git"]) {
      expect(() => assertSafeRepositoryPath(path)).toThrow(/not permitted/);
    }
    expect(() =>
      assertFramePolicy({
        agent: {
          agentId: "agent-1",
          refNamespace: "refs/heads/agents/agent-1",
          authenticatedAgent: 1,
        },
        currentRefs: {},
        frame: {
          accountingVersion: ACCOUNTING_VERSION,
          authenticatedAgent: 2,
          objectFormat: GIT_SHA256_OBJECT_FORMAT,
          publicationSlot: 1,
          operation: refOperations.create,
          refName: "refs/heads/agents/agent-1/work",
          oldOid: Buffer.alloc(32),
          newOid: Buffer.from("1".repeat(64), "hex"),
          objects: [],
        },
      }),
    ).toThrow(/sender attribution/);
  });

  test("rebuilds the exact frame from a connected, safe quarantine closure", async () => {
    const repository = await mkdtemp(join(tmpdir(), "palimpsest-quarantine-"));
    await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository]);
    await git(repository, ["config", "user.name", "Fixture"]);
    await git(repository, ["config", "user.email", "fixture@invalid"]);
    await writeFile(join(repository, "README.md"), "genesis\n");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "--quiet", "-m", "genesis"]);
    const baseBranch = await git(repository, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const visible = (
      await git(repository, ["rev-list", "--objects", "--no-object-names", "HEAD"])
    ).split("\n");
    await git(repository, ["switch", "--quiet", "-c", "agent-work"]);
    await writeFile(join(repository, "notes.md"), "safe work\n");
    await git(repository, ["add", "notes.md"]);
    await git(repository, ["commit", "--quiet", "-m", "agent work"]);
    const newOid = await git(repository, ["rev-parse", "HEAD"]);
    const frame = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid,
      operation: refOperations.create,
      publicationSlot: 1,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: new VisibilityJournal(visible),
    });
    const agent = {
      agentId: "agent-1",
      refNamespace: "refs/heads/agents/agent-1" as const,
      authenticatedAgent: 1,
    };
    await expect(
      validateQuarantinedFrame({
        agent,
        frame,
        quarantineRepository: repository,
        slotStartVisibleOids: visible,
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateQuarantinedFrame({
        agent,
        frame: { ...frame, objects: frame.objects.slice(1) },
        quarantineRepository: repository,
        slotStartVisibleOids: visible,
      }),
    ).rejects.toThrow(/does not match/);

    const acceptedTip = frame.newOid.toString("hex");
    await git(repository, ["switch", "--quiet", baseBranch]);
    await writeFile(join(repository, "divergent.md"), "divergent\n");
    await git(repository, ["add", "divergent.md"]);
    await git(repository, ["commit", "--quiet", "-m", "divergent"]);
    const divergentOid = await git(repository, ["rev-parse", "HEAD"]);
    const divergent = await buildLogicalTransaction({
      authenticatedAgent: 1,
      newOid: divergentOid,
      operation: refOperations.create,
      publicationSlot: 1,
      refName: "refs/heads/agents/agent-1/work",
      repository,
      slotStartJournal: new VisibilityJournal(visible),
    });
    await expect(
      validateQuarantinedFrame({
        agent,
        frame: {
          ...divergent,
          operation: refOperations.update,
          oldOid: Buffer.from(acceptedTip, "hex"),
        },
        quarantineRepository: repository,
        slotStartVisibleOids: visible,
      }),
    ).rejects.toThrow(/fast-forward/);
  });
});
