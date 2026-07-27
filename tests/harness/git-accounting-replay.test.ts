import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";
import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  gitAccountingCharge,
  refOperations,
  type GitAccountingFrameV1,
} from "@palimpsest/git-accounting";
import { publishSnapshot } from "@palimpsest/git-gateway";
import { afterEach, describe, expect, test } from "vitest";

import { RETAINED_COMMUNICATION_BUDGET_BYTES } from "../../tools/harness/config.js";
import { verifyGitAccountingReplay } from "../../tools/harness/replay.js";

const execFileAsync = promisify(execFile);
const agents = ["agent-1", "agent-2", "agent-3"] as const;
const roots: string[] = [];

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function refs(repository: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    (
      await git(repository, [
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads/main",
        "refs/heads/agents",
      ])
    )
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(" ");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function allowedOids(
  repository: string,
  publicationRefs: Record<string, string>,
): Promise<string[]> {
  return [
    ...new Set(
      (
        await git(repository, [
          "rev-list",
          "--objects",
          "--no-object-names",
          ...Object.values(publicationRefs),
        ])
      )
        .split("\n")
        .filter(Boolean),
    ),
  ].sort();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function accountingFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-accounting-fixture-"));
  roots.push(root);
  const repository = join(root, "source");
  const attempt = join(root, "attempt");
  await mkdir(join(attempt, "git"), { recursive: true });
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository]);
  await git(repository, ["config", "user.name", "Replay Fixture"]);
  await git(repository, ["config", "user.email", "replay@palimpsest.invalid"]);
  await writeFile(join(repository, "README.md"), "genesis\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "--quiet", "-m", "genesis"]);
  await git(repository, ["branch", "-M", "main"]);

  for (const agentId of agents) {
    await git(repository, ["switch", "--quiet", "-c", `${agentId}-fixture`, "main"]);
    await writeFile(join(repository, `${agentId}.txt`), `${agentId} work\n`);
    await git(repository, ["add", `${agentId}.txt`]);
    await git(repository, ["commit", "--quiet", "-m", `${agentId} work`]);
    await git(repository, [
      "update-ref",
      `refs/heads/agents/${agentId}/work`,
      await git(repository, ["rev-parse", "HEAD"]),
    ]);
  }
  const collaborationRefs = await refs(repository);

  for (const agentId of agents) {
    await git(repository, ["switch", "--quiet", `${agentId}-fixture`]);
    await writeFile(join(repository, `${agentId}-revision.txt`), `${agentId} revision\n`);
    await git(repository, ["add", `${agentId}-revision.txt`]);
    await git(repository, ["commit", "--quiet", "-m", `${agentId} revision`]);
    await git(repository, [
      "update-ref",
      `refs/heads/agents/${agentId}/work`,
      await git(repository, ["rev-parse", "HEAD"]),
    ]);
  }
  await git(repository, ["switch", "--quiet", "main"]);
  await git(repository, ["branch", "-D", "agent-1-fixture", "agent-2-fixture", "agent-3-fixture"]);
  const finalRefs = await refs(repository);
  const mainOids = (await git(repository, ["rev-list", "--objects", "--no-object-names", "main"]))
    .split("\n")
    .filter(Boolean);

  let slotStartJournal = new VisibilityJournal(mainOids);
  const frameSlots: GitAccountingFrameV1[][] = [];
  for (const [slotIndex, publicationRefs] of [collaborationRefs, finalRefs].entries()) {
    const priorRefs = slotIndex === 0 ? {} : collaborationRefs;
    const frames = await Promise.all(
      agents.map((agentId, index) => {
        const refName = `refs/heads/agents/${agentId}/work`;
        const oldOid = priorRefs[refName];
        return buildLogicalTransaction({
          authenticatedAgent: index + 1,
          newOid: publicationRefs[refName]!,
          ...(oldOid ? { oldOid } : {}),
          operation: oldOid ? refOperations.update : refOperations.create,
          publicationSlot: slotIndex + 1,
          refName,
          repository,
          slotStartJournal,
        });
      }),
    );
    frameSlots.push(frames);
    slotStartJournal = slotStartJournal.withAcceptedObjects(frames.map((frame) => frame.objects));
  }

  const remaining = Object.fromEntries(
    agents.map((agentId) => [agentId, RETAINED_COMMUNICATION_BUDGET_BYTES]),
  ) as Record<(typeof agents)[number], number>;
  const ledgers = frameSlots.flatMap((frames) =>
    frames.map((frame, index) => {
      const agentId = agents[index]!;
      const frameDigest = sha256Hex(encodeGitAccountingFrame(frame));
      const chargeBytes = gitAccountingCharge(frame);
      const budgetBefore = remaining[agentId]!;
      remaining[agentId] -= chargeBytes;
      return {
        schemaVersion: 1,
        contractId: "push-ledger-entry",
        runId: "run-1",
        agentId,
        transactionId: `${agentId}-push-${frameDigest}`,
        frameDigest,
        chargeBytes,
        budgetBefore,
        budgetAfter: remaining[agentId],
        result: "accepted",
      };
    }),
  );

  const publicationEvidence = [];
  const fetches = [];
  let sequence = 1;
  let predecessorSnapshotId: string | null = null;
  slotStartJournal = new VisibilityJournal(mainOids);
  for (const [slotIndex, publicationRefs] of [collaborationRefs, finalRefs].entries()) {
    slotStartJournal = slotStartJournal.withAcceptedObjects(
      frameSlots[slotIndex]!.map((frame) => frame.objects),
    );
    const ordinal = slotIndex + 1;
    const slot = ordinal === 1 ? "collaboration" : "final";
    const snapshot = publishSnapshot({
      runId: "run-1",
      ordinal,
      refs: publicationRefs,
      predecessorSnapshotId,
      visibilityJournalDigest: slotStartJournal.digest(),
      eventSequence: ordinal * 10,
    });
    predecessorSnapshotId = snapshot.snapshotId;
    const visible = await allowedOids(repository, publicationRefs);
    publicationEvidence.push({ slot, snapshot, refs: publicationRefs, allowedOids: visible });
    for (const agentId of agents) {
      const tupleBody = {
        snapshotId: snapshot.snapshotId,
        wants: [publicationRefs[`refs/heads/agents/${agentId}/work`]!],
        haves: [],
        capabilityProfile: [],
      };
      fetches.push({
        schemaVersion: 1,
        agentId,
        sequence,
        tuple: { ...tupleBody, digest: sha256Hex(canonicalJsonBytes(tupleBody)) },
      });
      sequence += 1;
    }
  }

  await writeFile(join(attempt, "git/ledgers.json"), canonicalJsonBytes(ledgers));
  for (const [index, evidence] of publicationEvidence.entries()) {
    const suffix = String(index + 1).padStart(3, "0");
    await writeFile(
      join(attempt, `git/publication-${suffix}.json`),
      canonicalJsonBytes(evidence.snapshot),
    );
    await writeFile(
      join(attempt, `git/fetch-publication-${suffix}.json`),
      canonicalJsonBytes({
        schemaVersion: 1,
        slot: evidence.slot,
        snapshot: evidence.snapshot,
        refs: evidence.refs,
        allowedOidCount: evidence.allowedOids.length,
        allowedOidsDigest: sha256Hex(canonicalJsonBytes(evidence.allowedOids)),
        maxFetchesPerAgent: 2,
      }),
    );
  }
  await writeFile(
    join(attempt, "git/fetches.json"),
    canonicalJsonBytes({
      maxFetchesPerAgent: 2,
      admittedFetchCounts: Object.fromEntries(agents.map((agentId) => [agentId, 2])),
      fetches,
    }),
  );
  const finalPublication = publicationEvidence[1]!.snapshot;
  await writeFile(
    join(attempt, "git/freeze.json"),
    canonicalJsonBytes({
      refMapDigest: finalPublication.refMapDigest,
      visibilityJournalDigest: finalPublication.visibilityJournalDigest,
    }),
  );
  const liveEvents = Array.from({ length: 21 }, () => ({
    eventType: "fixture",
    payload: {},
  }));
  for (const evidence of publicationEvidence) {
    liveEvents[evidence.snapshot.eventSequence] = {
      eventType: "git.publication",
      payload: { snapshotId: evidence.snapshot.snapshotId },
    };
  }
  await writeFile(
    join(attempt, "live.jsonl"),
    `${liveEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  await git(repository, [
    "bundle",
    "create",
    join(attempt, "git/frozen.bundle"),
    "refs/heads/main",
    "refs/heads/agents/agent-1/work",
    "refs/heads/agents/agent-2/work",
    "refs/heads/agents/agent-3/work",
  ]);
  return attempt;
}

describe("independent Git accounting replay", () => {
  test("rebuilds both publication-slot frames and visibility from the frozen Git bundle", async () => {
    const attempt = await accountingFixture();
    await expect(verifyGitAccountingReplay(attempt)).resolves.toBeUndefined();

    const ledgerPath = join(attempt, "git/ledgers.json");
    const ledgers = JSON.parse(await readFile(ledgerPath, "utf8")) as Array<
      Record<string, unknown>
    >;
    ledgers[3]!.frameDigest = "0".repeat(64);
    await writeFile(ledgerPath, canonicalJsonBytes(ledgers));
    await expect(verifyGitAccountingReplay(attempt)).rejects.toThrow(
      /accounting frame does not match ledger/,
    );
  });
});
