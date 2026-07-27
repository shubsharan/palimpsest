import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AgentId,
  type EvaluationResult,
  type EvaluationSelection,
  createDockerCommandSandbox,
  evaluateFrozenAttempt,
} from "../../packages/puzzle-runner/src/index.js";

import {
  appendTraceEvent,
  parseFlags,
  readJsonObject,
  requiredFlag,
  runPythonJson,
} from "./common.js";

export interface EvaluatePuzzleOptions {
  root: string;
  attempt: string;
  workspace?: AgentId;
  command?: string;
  outputPath?: string;
  notes?: string;
}

function attemptRootFrom(path: string): string {
  const resolved = resolve(path);
  return basename(resolved) === "frozen" ? dirname(resolved) : resolved;
}

export async function evaluatePuzzle(options: EvaluatePuzzleOptions): Promise<EvaluationResult> {
  const root = resolve(options.root);
  const attemptRoot = attemptRootFrom(options.attempt);
  const attempt = await readJsonObject(join(attemptRoot, "attempt.json"));
  if (
    typeof attempt.buildRoot !== "string" ||
    typeof attempt.tracePath !== "string" ||
    typeof attempt.frozenRoot !== "string" ||
    typeof attempt.sandbox !== "object" ||
    attempt.sandbox === null ||
    typeof (attempt.sandbox as { imageId?: unknown }).imageId !== "string"
  ) {
    throw new Error("Attempt summary is missing build, trace, frozen, or sandbox identity.");
  }
  if ((options.command === undefined) !== (options.outputPath === undefined)) {
    throw new Error("Reviewer command and output path must be provided together.");
  }
  const workspace = options.workspace ?? "agent-1";
  const selection: EvaluationSelection | undefined =
    options.command === undefined || options.outputPath === undefined
      ? undefined
      : {
          command: options.command,
          outputPath: options.outputPath,
          ...(options.notes === undefined ? {} : { notes: options.notes }),
        };
  const build = await readJsonObject(join(attempt.buildRoot, "puzzle-build.json"));
  if (typeof build.publicCiphertextPath !== "string" || typeof build.oracleRoot !== "string") {
    throw new Error("Puzzle build is missing evaluation paths.");
  }
  const sandbox = await createDockerCommandSandbox({
    root,
    expectedImageId: (attempt.sandbox as { imageId: string }).imageId,
  });
  return evaluateFrozenAttempt({
    frozenWorkspacePath: join(attempt.frozenRoot, "workspaces", workspace),
    frozenGitPath: join(attempt.frozenRoot, "shared.git"),
    evaluationRoot: join(attemptRoot, "evaluation"),
    ciphertextPath: join(attempt.buildRoot, build.publicCiphertextPath),
    sandbox,
    selection,
    score: async ({ outputPath }) =>
      runPythonJson(root, "palimpsest.puzzle.score", [
        "--truth",
        join(attempt.buildRoot as string, build.oracleRoot as string, "plaintext.txt"),
        "--candidate",
        outputPath,
      ]),
    observe: async (kind, data) => appendTraceEvent(attempt.tracePath as string, kind, data),
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const workspace = flags.get("--workspace");
  if (
    workspace !== undefined &&
    workspace !== "agent-1" &&
    workspace !== "agent-2" &&
    workspace !== "agent-3"
  ) {
    throw new Error("--workspace must be agent-1, agent-2, or agent-3.");
  }
  const command = flags.get("--command");
  const outputPath = flags.get("--output");
  const notes = flags.get("--notes");
  const result = await evaluatePuzzle({
    root: resolve("."),
    attempt: requiredFlag(flags, "--attempt"),
    ...(workspace === undefined ? {} : { workspace }),
    ...(command === undefined ? {} : { command }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(notes === undefined ? {} : { notes }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
