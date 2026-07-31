import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FrozenGitEnvironment, GitRepositoryId } from "./git.js";
import type { AgentId, JsonObject, ModelBinding } from "./model.js";
import type { SandboxIdentity } from "./sandbox/contracts.js";
import type { AgentSessionResult } from "./session.js";

export interface ResolvedRunRecord {
  id: string;
  fixture: {
    id: string;
    packagePath: string;
    digest: string;
    variant: string;
  };
  assignment: Readonly<Record<AgentId, string>>;
  capabilities: {
    git: "shared" | "isolated";
    teamRoom: "enabled" | "disabled";
  };
  schedule: {
    releaseOffsetsMs: readonly number[];
    cutoffMs: number;
  };
  limits: {
    tokenLimitPerAgent: number | null;
    spendCeilingCents: number;
  };
  labels: JsonObject;
}

export interface RunEvaluation {
  repositoryId: GitRepositoryId;
  agentIds: readonly AgentId[];
  status: "scored" | "not-runnable" | "no-output" | "execution-error";
  commit?: string;
  outputPath?: string;
  score?: {
    matchedWords: number;
    totalWords: number;
    coverage: number;
    accuracy: number;
  };
  error?: string;
}

export interface RunRecord {
  schemaVersion: 1;
  experimentId: string;
  run: ResolvedRunRecord;
  models: readonly { agentId: AgentId; binding: ModelBinding }[];
  sessions: readonly AgentSessionResult[];
  trace: { path: string; metadataPath: string };
  frozen: FrozenGitEnvironment;
  sandbox: SandboxIdentity;
  evaluations: readonly RunEvaluation[];
  status: "completed" | "infrastructure-error";
}

function validateRunRecord(record: RunRecord): void {
  if (
    record.schemaVersion !== 1 ||
    record.experimentId.trim() === "" ||
    record.run.id.trim() === ""
  ) {
    throw new Error("Run record identity is invalid.");
  }
  const agentIds = Object.keys(record.run.assignment) as AgentId[];
  if (
    agentIds.length === 0 ||
    new Set(agentIds).size !== agentIds.length ||
    record.models.map(({ agentId }) => agentId).join("\0") !== agentIds.join("\0") ||
    record.sessions.map(({ agentId }) => agentId).join("\0") !== agentIds.join("\0")
  ) {
    throw new Error("Run record models and sessions must match the declared agents.");
  }
  const repositoryIds = record.frozen.repositories.map(({ repositoryId }) => repositoryId);
  if (
    record.evaluations.map(({ repositoryId }) => repositoryId).join("\0") !==
    repositoryIds.join("\0")
  ) {
    throw new Error("Run record must evaluate every canonical origin in frozen order.");
  }
  const hasInfrastructureError = record.sessions.some(
    ({ state }) => state === "infrastructure-error",
  );
  if ((record.status === "infrastructure-error") !== hasInfrastructureError) {
    throw new Error("Run record status must reflect its session outcomes.");
  }
}

export async function publishRunRecord(runRoot: string, record: RunRecord): Promise<string> {
  validateRunRecord(record);
  const path = join(runRoot, "run.json");
  const temporaryPath = join(runRoot, ".run.json.tmp");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath);
  }
  return path;
}
