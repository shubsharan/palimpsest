import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishRunRecord, type RunRecord } from "./records.js";

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
    trace: { path: "/run/trace.jsonl", metadataPath: "/run/trace.meta.json" },
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

describe("run records", () => {
  it("publishes one final record atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-record-"));
    const path = await publishRunRecord(root, record());
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: 1,
      experimentId: "experiment",
      run: { id: "run-1" },
    });
  });

  it("requires an evaluation for every frozen origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-record-"));
    const invalid = { ...record(), evaluations: [] };
    await expect(publishRunRecord(root, invalid)).rejects.toThrow(/every canonical origin/i);
  });

  it("never replaces an already published scientific record", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-record-"));
    await publishRunRecord(root, record());
    await expect(
      publishRunRecord(root, { ...record(), experimentId: "replacement" }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(join(root, "run.json"), "utf8"))).toMatchObject({
      experimentId: "experiment",
    });
  });
});
