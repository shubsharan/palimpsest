import { describe, expect, it } from "vitest";

import type { AgentAssignment, ResolvedRun, RunDeclaration } from "../experiment/contracts.js";
import type {
  AgentSessionResult,
  AgentToolSet,
  ModelBinding,
  ModelSettings,
  ModelSessionContext,
  ProviderConnection,
  ProviderDriver,
  ToolDefinition,
} from "./contracts.js";
import type { AgentPromptOptions } from "../run/prompt.js";
import type { RunExecutionResult, RunPreparedFixtureOptions } from "../run/execution.js";
import type { ResolvedRunRecord } from "../run/record.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

type ModelOwnership = [
  Expect<Equal<ProviderConnection["driver"], ProviderDriver>>,
  Expect<Equal<ModelBinding["settings"], ModelSettings>>,
  Expect<Equal<ModelSessionContext["tools"], readonly ToolDefinition[]>>,
  Expect<Equal<AgentToolSet["definitions"], readonly ToolDefinition[]>>,
  Expect<Equal<AgentSessionResult["model"], ModelBinding>>,
];

type ExperimentOwnership = [
  Expect<Equal<RunDeclaration["assignment"], AgentAssignment>>,
  Expect<Equal<ResolvedRun["capabilities"], RunDeclaration["capabilities"]>>,
  Expect<Equal<ResolvedRun["schedule"], RunDeclaration["schedule"]>>,
  Expect<Equal<ResolvedRun["limits"], RunDeclaration["limits"]>>,
  Expect<Equal<AgentPromptOptions["capabilities"], ResolvedRun["capabilities"]>>,
  Expect<Equal<AgentPromptOptions["schedule"], ResolvedRun["schedule"]>>,
  Expect<Equal<AgentPromptOptions["limits"], ResolvedRun["limits"]>>,
  Expect<Equal<RunPreparedFixtureOptions["capabilities"], ResolvedRun["capabilities"]>>,
  Expect<Equal<RunPreparedFixtureOptions["schedule"], ResolvedRun["schedule"]>>,
  Expect<Equal<RunPreparedFixtureOptions["limits"], ResolvedRun["limits"]>>,
];

type ProducedRunState = Expect<
  Equal<
    keyof RunExecutionResult,
    | "frozen"
    | "frozenAt"
    | "releases"
    | "sandbox"
    | "sessions"
    | "startedAt"
    | "traceMetadataPath"
    | "tracePath"
  >
>;

type RecordOwnership = [
  Expect<Equal<ResolvedRunRecord["assignment"], ResolvedRun["assignment"]>>,
  Expect<Equal<ResolvedRunRecord["capabilities"], ResolvedRun["capabilities"]>>,
  Expect<Equal<ResolvedRunRecord["schedule"], ResolvedRun["schedule"]>>,
  Expect<Equal<ResolvedRunRecord["limits"], ResolvedRun["limits"]>>,
  Expect<Equal<ResolvedRunRecord["labels"], ResolvedRun["labels"]>>,
  Expect<Equal<keyof ResolvedRunRecord["fixture"], "digest" | "id" | "packagePath" | "variant">>,
];

describe("canonical type ownership", () => {
  it("keeps dependent contracts linked to their canonical owners", () => {
    const proof:
      | ModelOwnership[number]
      | ExperimentOwnership[number]
      | RecordOwnership[number]
      | ProducedRunState = true;
    expect(proof).toBe(true);
  });
});
