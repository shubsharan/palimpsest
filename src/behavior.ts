import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { AttemptSummary } from "./artifacts.js";
import type { EvaluationRecord } from "./evaluate.js";
import { readObservationEvents, type ObservationEvent } from "./trace.js";

function fact(event: ObservationEvent) {
  return {
    sequence: event.sequence,
    atMs: event.atMs,
    ...(event.agentId === undefined ? {} : { agentId: event.agentId }),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function reasoningStatus(event: ObservationEvent): "returned" | "empty" | "unavailable" | "absent" {
  const returned = record(record(event.data)?.returnedReasoningSummary);
  if (returned === undefined) return "absent";
  if (returned.status === "response-body-unavailable") return "unavailable";
  if (returned.status !== "captured" || !Array.isArray(returned.items)) return "absent";
  const hasEntry = returned.items.some((item) => {
    const summary = record(item)?.summary;
    return Array.isArray(summary) && summary.length > 0;
  });
  return hasEntry ? "returned" : "empty";
}

export async function publishBehaviorEvidence(options: {
  attempt: AttemptSummary;
  evaluation: EvaluationRecord;
  attemptRoot: string;
}): Promise<void> {
  const root = resolve(options.attemptRoot);
  const events = await readObservationEvents(options.attempt.tracePath);
  const responses = events.filter(({ kind }) => kind === "model.response");
  const evidence = {
    schemaVersion: 1,
    rubricId: "palimpsest-behavior-review-v1",
    attemptId: options.attempt.attemptId,
    condition: options.attempt.condition,
    facts: {
      teamMessages: events.filter(({ kind }) => kind === "team.message").map(fact),
      checkerEvents: events
        .filter(
          ({ kind, data }) =>
            kind === "tool.completed" && record(data)?.name === "check_published_solver",
        )
        .map(fact),
      gitActivity: events
        .filter(({ kind }) => kind === "git.changed")
        .map((event) => ({
          ...fact(event),
          refs: Array.isArray(record(event.data)?.refs) ? record(event.data)!.refs : [],
        })),
      agents: options.attempt.sessions.map((session) => {
        const agentResponses = responses.filter(({ agentId }) => agentId === session.agentId);
        return {
          agentId: session.agentId,
          usage: { inputTokens: session.inputTokens, outputTokens: session.outputTokens },
          reasoningSummaries: {
            returned: agentResponses.filter((event) => reasoningStatus(event) === "returned")
              .length,
            empty: agentResponses.filter((event) => reasoningStatus(event) === "empty").length,
            unavailable: agentResponses.filter((event) => reasoningStatus(event) === "unavailable")
              .length,
            absent: agentResponses.filter((event) => reasoningStatus(event) === "absent").length,
          },
        };
      }),
      finalOrigins: options.evaluation.origins.map(({ origin, status, outputProvenance }) => ({
        originId: origin.originId,
        status,
        ...(origin.commit === undefined ? {} : { commit: origin.commit }),
        ...(outputProvenance === undefined ? {} : { outputPath: outputProvenance.path }),
      })),
    },
    artifacts: {
      attempt: "attempt.json",
      trace: relative(root, options.attempt.tracePath),
      evaluation: options.attempt.evaluationPath,
    },
  };
  await writeFile(join(root, "behavior-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
