import { runPythonJson } from "./python.js";
import type { CheckerHook, CheckerResult } from "./tools.js";

const FEEDBACK_ID = "published-runnability-coverage-v1" as const;

function strictRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Checker result must be an object.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "feedbackId",
    "outputValidity",
    "ciphertextWords",
    "outputWords",
    "coverage",
    "error",
  ]);
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra !== undefined) throw new Error(`Checker result contains unknown field ${extra}.`);
  return record;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Checker result ${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

export function decodeCheckerResult(value: unknown): CheckerResult {
  const record = strictRecord(value);
  if (record.feedbackId !== FEEDBACK_ID) {
    throw new Error("Checker result feedbackId is unsupported.");
  }
  if (
    record.outputValidity !== "valid" &&
    record.outputValidity !== "incomplete" &&
    record.outputValidity !== "malformed"
  ) {
    throw new Error("Checker result outputValidity is unsupported.");
  }
  if (record.outputValidity === "malformed") {
    if (typeof record.error !== "string" || record.error.length === 0) {
      throw new Error("Malformed checker results require an error.");
    }
    if (
      record.ciphertextWords !== undefined ||
      record.outputWords !== undefined ||
      record.coverage !== undefined
    ) {
      throw new Error("Malformed checker results cannot contain word counts or coverage.");
    }
    return { feedbackId: FEEDBACK_ID, outputValidity: "malformed", error: record.error };
  }
  if (record.error !== undefined) {
    throw new Error("Readable checker results cannot contain an error.");
  }
  const ciphertextWords = nonNegativeInteger(record.ciphertextWords, "ciphertextWords");
  const outputWords = nonNegativeInteger(record.outputWords, "outputWords");
  if (
    typeof record.coverage !== "number" ||
    !Number.isFinite(record.coverage) ||
    record.coverage < 0 ||
    record.coverage > 1
  ) {
    throw new Error("Checker result coverage must be between 0 and 1.");
  }
  const expectedValidity = outputWords >= ciphertextWords ? "valid" : "incomplete";
  const expectedCoverage = ciphertextWords === 0 ? Number(outputWords === 0) : Math.min(outputWords, ciphertextWords) / ciphertextWords;
  if (record.outputValidity !== expectedValidity || record.coverage !== expectedCoverage) {
    throw new Error("Checker result coverage fields are inconsistent.");
  }
  return {
    feedbackId: FEEDBACK_ID,
    outputValidity: record.outputValidity,
    ciphertextWords,
    outputWords,
    coverage: record.coverage,
  };
}

export function createChecker(root: string): CheckerHook {
  return async (request) => {
    return decodeCheckerResult(
      await runPythonJson(
        root,
        "palimpsest.evaluation.checker",
        [
          "--ciphertext",
          request.ciphertextPath,
          "--candidate",
          request.candidatePath,
        ],
        request.signal,
      ),
    );
  };
}
