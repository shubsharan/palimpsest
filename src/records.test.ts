import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishRunRecord, type RunRecord } from "./records.js";
import { JsonlObservationLog } from "./trace.js";

function record(): RunRecord {
  return {
    schemaVersion: 1,
    experimentId: "experiment",
    run: {
      id: "run-1",
      fixture: {
        id: "fixture",
        packagePath: "/fixture",
        digest: "a".repeat(64),
        variant: "stationary",
      },
      assignment: { "agent-1": "model" },
      capabilities: { git: "isolated", teamRoom: "disabled" },
      schedule: { releaseOffsetsMs: [0], cutoffMs: 1000 },
      limits: { tokenLimitPerAgent: null, spendCeilingCents: 0 },
      labels: {},
    },
    models: [
      {
        agentId: "agent-1",
        binding: {
          profile: "model",
          provider: "fixture",
          driver: "openai-compatible",
          requestedModel: "fixture",
          settings: {},
          providerOptions: {},
        },
      },
    ],
    sessions: [
      {
        agentId: "agent-1",
        model: {
          profile: "model",
          provider: "fixture",
          driver: "openai-compatible",
          requestedModel: "fixture",
          settings: {},
          providerOptions: {},
        },
        state: "finished",
        inputTokens: 0,
        outputTokens: 0,
        activityCursor: 0,
        terminationReason: "final-response",
      },
    ],
    trace: { path: "trace.jsonl", metadataPath: "trace.meta.json" },
    frozen: {
      frozen: true,
      root: "/run/frozen",
      communicationMode: "isolated",
      repositories: [{ repositoryId: "agent-1", path: "/run/frozen/repo", agentIds: ["agent-1"] }],
      workspaces: [{ agentId: "agent-1", path: "/run/frozen/workspace", repositoryId: "agent-1" }],
      treeSeal: { schemaVersion: 1, digest: "b".repeat(64), fileCount: 1, byteCount: 1 },
    },
    sandbox: {
      imageTag: "sandbox",
      imageId: `sha256:${"c".repeat(64)}`,
      sourceDigest: "d".repeat(64),
      profileVersion: 1,
    },
    evaluations: [{ repositoryId: "agent-1", agentIds: ["agent-1"], status: "not-runnable" }],
    status: "completed",
  };
}

async function runRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-record-"));
  await JsonlObservationLog.create(join(root, "trace.jsonl"));
  return root;
}

describe("run records", () => {
  it("publishes one final record atomically", async () => {
    const root = await runRoot();
    const path = await publishRunRecord(root, record());
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: 1,
      experimentId: "experiment",
      run: { id: "run-1" },
    });
  });

  it("requires an evaluation for every frozen origin", async () => {
    const root = await runRoot();
    const invalid = { ...record(), evaluations: [] };
    await expect(publishRunRecord(root, invalid)).rejects.toThrow(/every canonical origin/i);
  });

  it("never replaces an already published scientific record", async () => {
    const root = await runRoot();
    await publishRunRecord(root, record());
    await expect(
      publishRunRecord(root, { ...record(), experimentId: "replacement" }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(join(root, "run.json"), "utf8"))).toMatchObject({
      experimentId: "experiment",
    });
  });

  it("requires canonical relative trace paths", async () => {
    const root = await runRoot();
    await expect(
      publishRunRecord(root, {
        ...record(),
        trace: { path: join(root, "trace.jsonl"), metadataPath: "trace.meta.json" },
      }),
    ).rejects.toThrow(/trace paths must be trace\.jsonl and trace\.meta\.json/i);
  });

  it("accepts valid events appended before publication", async () => {
    const root = await runRoot();
    const log = await JsonlObservationLog.open(join(root, "trace.jsonl"));
    await log.append("review.note", { accepted: true });
    await log.flush();

    await expect(publishRunRecord(root, record())).resolves.toBe(join(root, "run.json"));
  });

  it.each([
    ["missing metadata", async (root: string) => rm(join(root, "trace.meta.json"))],
    ["malformed", async (root: string) => writeFile(join(root, "trace.jsonl"), "not-json\n")],
    [
      "nonsequential",
      async (root: string) =>
        writeFile(
          join(root, "trace.jsonl"),
          `${JSON.stringify({ sequence: 2, atMs: 1, kind: "event", data: {} })}\n`,
        ),
    ],
    [
      "timestamp-regressing",
      async (root: string) =>
        writeFile(
          join(root, "trace.jsonl"),
          [
            JSON.stringify({ sequence: 1, atMs: 2, kind: "event", data: {} }),
            JSON.stringify({ sequence: 2, atMs: 1, kind: "event", data: {} }),
            "",
          ].join("\n"),
        ),
    ],
  ])("rejects a %s trace before publication", async (_name, corrupt) => {
    const root = await runRoot();
    await corrupt(root);
    await expect(publishRunRecord(root, record())).rejects.toThrow();
  });
});
