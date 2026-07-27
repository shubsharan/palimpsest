export const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AttemptConfig {
  attemptId: string;
  artifactRoot: string;
  buildPath: string;
  referenceCorpusPath: string;
  agentStages: Record<AgentId, readonly string[]>;
  tokenBudgetPerAgent: number;
  wallTimeMs: number;
  stageIntervalMs: number;
  shutdownToleranceMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

function requirePositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${key} must be a positive safe integer.`);
  }
  return value as number;
}

export function validateAttemptConfig(value: unknown): AttemptConfig {
  if (!isRecord(value)) {
    throw new Error("Attempt configuration must be an object.");
  }
  const stagesValue = value.agentStages;
  if (!isRecord(stagesValue)) {
    throw new Error("agentStages must describe exactly three agents.");
  }
  const stageKeys = Object.keys(stagesValue).sort();
  if (
    stageKeys.length !== AGENT_IDS.length ||
    AGENT_IDS.some((agentId, index) => stageKeys[index] !== agentId)
  ) {
    throw new Error("agentStages must describe exactly three agents.");
  }
  const requireStages = (agentId: AgentId): readonly string[] => {
    const stages = stagesValue[agentId];
    if (
      !Array.isArray(stages) ||
      stages.length !== 6 ||
      stages.some((stage) => typeof stage !== "string" || stage.length === 0)
    ) {
      throw new Error(`${agentId} must have exactly six stages.`);
    }
    return [...stages] as string[];
  };
  const agentStages: Record<AgentId, readonly string[]> = {
    "agent-1": requireStages("agent-1"),
    "agent-2": requireStages("agent-2"),
    "agent-3": requireStages("agent-3"),
  };

  return {
    attemptId: requireNonEmptyString(value, "attemptId"),
    artifactRoot: requireNonEmptyString(value, "artifactRoot"),
    buildPath: requireNonEmptyString(value, "buildPath"),
    referenceCorpusPath: requireNonEmptyString(value, "referenceCorpusPath"),
    agentStages,
    tokenBudgetPerAgent: requirePositiveInteger(value, "tokenBudgetPerAgent"),
    wallTimeMs: requirePositiveInteger(value, "wallTimeMs"),
    stageIntervalMs: requirePositiveInteger(value, "stageIntervalMs"),
    shutdownToleranceMs: requirePositiveInteger(value, "shutdownToleranceMs"),
  };
}

export function parseAttemptConfig(source: string): AttemptConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Attempt configuration is not valid JSON: ${detail}`);
  }
  return validateAttemptConfig(parsed);
}
