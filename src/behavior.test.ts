import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeAttemptSummary } from "./artifacts.js";
import { publishBehaviorEvidence } from "./behavior.js";
import type { EvaluationRecord } from "./evaluate.js";
import { testAttemptSummary } from "./test-helpers.js";
import { JsonlObservationLog } from "./trace.js";

describe("behavior evidence", () => {
  it("publishes trace-grounded facts without semantic classifications", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-behavior-"));
    const tracePath = join(root, "trace.jsonl");
    const log = await JsonlObservationLog.create(tracePath, { startedAtMs: 0, nowMs: () => 1 });
    await log.append("team.message", { message: "share" }, "agent-1");
    await log.append("git.changed", { refs: ["refs/heads/main"] }, "agent-2");
    await log.append(
      "tool.completed",
      { id: "check", name: "check_published_solver", output: {} },
      "agent-3",
    );
    await log.append(
      "model.response",
      { returnedReasoningSummary: { status: "captured", items: [] } },
      "agent-1",
    );
    await log.flush();

    const attempt = decodeAttemptSummary({
      ...testAttemptSummary({ condition: "CS" }),
      tracePath,
      traceMetadataPath: join(root, "trace.meta.json"),
    });
    const evaluation: EvaluationRecord = {
      schemaVersion: 2,
      evaluationPolicyId: "all-canonical-main-snapshots-v1",
      primaryMetricId: "normalized-positional-word-v1",
      diagnosticMetricId: "palimpsest-diagnostics-v1",
      attemptId: attempt.attemptId,
      condition: attempt.condition,
      buildId: attempt.buildId,
      protocolDigest: attempt.protocolDigest,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      origins: [
        {
          origin: {
            originId: "shared",
            repositoryId: "shared",
            ref: "refs/heads/main",
            realizedTeamProduct: true,
          },
          status: "not-runnable",
          error: "missing main",
        },
      ],
      team: {
        realizedProductOriginId: "shared",
        collectiveCeiling: null,
        integrationGap: null,
        integrationGapReason: "shared-single-origin",
      },
    };

    await publishBehaviorEvidence({ attempt, evaluation, attemptRoot: root });
    const source = await readFile(join(root, "behavior-evidence.json"), "utf8");
    const evidence = JSON.parse(source) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      rubricId: "palimpsest-behavior-review-v1",
      facts: {
        teamMessages: [{ sequence: 1, agentId: "agent-1" }],
        gitActivity: [{ sequence: 2, agentId: "agent-2" }],
        checkerEvents: [{ sequence: 3, agentId: "agent-3" }],
        agents: expect.arrayContaining([
          expect.objectContaining({
            agentId: "agent-1",
            reasoningSummaries: { returned: 0, empty: 1, unavailable: 0, absent: 0 },
          }),
        ]),
      },
    });
    expect(source).not.toMatch(/classification|integration|interference|beliefReplacement/);
  });
});
