import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_IDS,
  FixtureAgentAdapter,
  OpenAIAgentAdapter,
  type AgentAdapter,
  type AgentId,
  type AgentTurn,
  type AttemptConfig,
  type AttemptResult,
  type CheckerHook,
  createDockerCommandSandbox,
  runAttempt,
  SANDBOX_POLICY,
} from "../../packages/puzzle-runner/src/index.js";

import {
  absoluteFrom,
  appendTraceEvent,
  integerFlag,
  parseFlags,
  readJsonObject,
  requiredFlag,
  runProcess,
  runProcessBuffer,
  runPythonJson,
} from "./common.js";

interface BuildStage {
  agentId: AgentId;
  ordinal: number;
  sourcePath: string;
}

interface BuildManifest {
  buildId: string;
  stageIntervalMs: number;
  publicCiphertextPath: string;
  referenceCorpusPath: string;
  oracleRoot: string;
  stages: BuildStage[];
}

export interface RunPuzzleOptions {
  root: string;
  buildRoot: string;
  output: string;
  adapter: "fixture" | "openai";
  tokenBudget: number;
  wallTimeMs: number;
  model?: string;
  fixtureScenario?: string;
}

export interface RunPuzzleResult extends AttemptResult {
  attemptRoot: string;
  buildRoot: string;
  overlap: Record<string, unknown>;
}

function requireBuildManifest(value: Record<string, unknown>): BuildManifest {
  if (
    typeof value.buildId !== "string" ||
    !Number.isSafeInteger(value.stageIntervalMs) ||
    typeof value.publicCiphertextPath !== "string" ||
    typeof value.referenceCorpusPath !== "string" ||
    typeof value.oracleRoot !== "string" ||
    !Array.isArray(value.stages)
  ) {
    throw new Error("Puzzle build manifest is missing required fields.");
  }
  const stages = value.stages.map((stage) => {
    if (
      typeof stage !== "object" ||
      stage === null ||
      !AGENT_IDS.includes((stage as { agentId: AgentId }).agentId) ||
      !Number.isSafeInteger((stage as { ordinal: number }).ordinal) ||
      typeof (stage as { sourcePath: unknown }).sourcePath !== "string"
    ) {
      throw new Error("Puzzle build contains an invalid evidence stage.");
    }
    return stage as BuildStage;
  });
  return { ...value, stages } as unknown as BuildManifest;
}

function fixtureAdapter(_scenario = "collaborative-revision"): FixtureAgentAdapter {
  const solverCommand = [
    `printf '%s\\n' '#!/bin/sh' 'cp "$PALIMPSEST_CIPHERTEXT" "$PALIMPSEST_OUTPUT"' > solve.sh`,
    "chmod +x solve.sh",
    "git add solve.sh",
    "git commit -m 'add fixture solver'",
    "git push origin HEAD:main",
  ].join(" && ");
  const scripts: Record<AgentId, readonly AgentTurn[]> = {
    "agent-1": [
      {
        toolCalls: [{ id: "solver", name: "run_command", arguments: { command: solverCommand } }],
        usage: { inputTokens: 3, outputTokens: 2 },
      },
      {
        toolCalls: [],
        finalResponse: "Published a runnable solver.",
        usage: { inputTokens: 2, outputTokens: 2 },
      },
    ],
    "agent-2": [
      {
        toolCalls: [
          {
            id: "rule-v1",
            name: "run_command",
            arguments: {
              command:
                "printf 'mapping=v1\\n' > rule.txt && git add rule.txt && git commit -m 'record initial rule' && git push origin HEAD:refs/heads/agent-2",
            },
          },
        ],
        usage: { inputTokens: 2, outputTokens: 1 },
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        toolCalls: [
          {
            id: `wait-before-revision-${index + 1}`,
            name: "wait_for_activity" as const,
            arguments: { afterSequence: 0 },
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
      {
        toolCalls: [
          {
            id: "rule-v2",
            name: "run_command",
            arguments: {
              command:
                "printf 'mapping=v2\\n' > rule.txt && git add rule.txt && git commit -m 'revise rule after new evidence' && git push origin HEAD:refs/heads/agent-2",
            },
          },
        ],
        usage: { inputTokens: 2, outputTokens: 1 },
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        toolCalls: [
          {
            id: `wait-after-revision-${index + 1}`,
            name: "wait_for_activity" as const,
            arguments: { afterSequence: 0 },
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
      {
        toolCalls: [
          { id: "fetch", name: "run_command", arguments: { command: "git fetch origin" } },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        toolCalls: [],
        finalResponse: "Reviewed peer activity and revised a prior rule.",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ],
    "agent-3": [
      {
        toolCalls: [
          {
            id: "candidate",
            name: "run_command",
            arguments: { command: "printf 'placeholder\\n' > candidate.txt" },
          },
          {
            id: "check",
            name: "check_reconstruction",
            arguments: { candidatePath: "candidate.txt" },
          },
        ],
        usage: { inputTokens: 3, outputTokens: 2 },
      },
      {
        toolCalls: [],
        finalResponse: "Checked an independent candidate.",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ],
  };
  return new FixtureAgentAdapter(scripts);
}

function openAIAdapter(model: string): OpenAIAgentAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live OpenAI adapter.");
  return new OpenAIAgentAdapter({
    model,
    client: {
      responses: {
        async create(body, options) {
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
          });
          if (!response.ok) {
            throw new Error(
              `OpenAI Responses request failed with ${response.status}: ${await response.text()}`,
            );
          }
          return response.json();
        },
      },
    },
  });
}

function checkerHook(root: string, buildRoot: string): CheckerHook {
  return async (request) => {
    if (request.releasedStages.length === 0) {
      return { matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 };
    }
    return runPythonJson(
      root,
      "palimpsest.puzzle.checker",
      [
        "--build",
        buildRoot,
        "--agent",
        request.agentId,
        "--released",
        request.releasedStages.join(","),
        "--candidate",
        request.candidatePath,
      ],
      request.signal,
    ) as Promise<
      | { matchedWords: number; totalWords: number; coverage: number; accuracy: number }
      | { error: string }
    >;
  };
}

export interface GitOverlapScan {
  reachableObjectCount: number;
  reachableBlobReferenceCount: number;
  uniqueReachableBlobCount: number;
  uniqueTextBlobCount: number;
  repeatedTreeReferenceCount: number;
  skippedNonTextBlobCount: number;
}

export interface CommittedFileCollection {
  committed: Record<string, string>;
  scan: GitOverlapScan;
}

function nonEmptyLines(value: string): string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

function parseTreeBlobIds(source: Buffer): string[] {
  return source
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const tab = entry.indexOf("\t");
      const metadata = (tab === -1 ? entry : entry.slice(0, tab)).split(/\s+/);
      return metadata[1] === "blob" && metadata[2] ? [metadata[2]] : [];
    });
}

export async function collectCommittedFiles(
  barePath: string,
  outputRoot: string,
): Promise<CommittedFileCollection> {
  await mkdir(outputRoot, { recursive: true });
  const reachableObjectIds = [
    ...new Set(
      nonEmptyLines(
        (
          await runProcess(
            "git",
            ["--git-dir", barePath, "rev-list", "--objects", "--all", "--no-object-names"],
            { cwd: dirname(barePath) },
          )
        ).stdout,
      ),
    ),
  ];
  const classifications =
    reachableObjectIds.length === 0
      ? ""
      : (
          await runProcess(
            "git",
            [
              "--git-dir",
              barePath,
              "cat-file",
              "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            ],
            {
              cwd: dirname(barePath),
              input: `${reachableObjectIds.join("\n")}\n`,
            },
          )
        ).stdout;
  const blobIds = nonEmptyLines(classifications).flatMap((line) => {
    const [objectId, objectType] = line.split(" ");
    return objectType === "blob" && objectId ? [objectId] : [];
  });

  const commitIds = nonEmptyLines(
    (
      await runProcess("git", ["--git-dir", barePath, "rev-list", "--all"], {
        cwd: dirname(barePath),
      })
    ).stdout,
  );
  const referencedBlobIds: string[] = [];
  for (const commitId of commitIds) {
    const tree = await runProcessBuffer(
      "git",
      ["--git-dir", barePath, "ls-tree", "-r", "-z", commitId],
      { cwd: dirname(barePath) },
    );
    referencedBlobIds.push(...parseTreeBlobIds(tree.stdout));
  }

  const committed: Record<string, string> = {};
  let skippedNonTextBlobCount = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const objectId of blobIds) {
    const content = (
      await runProcessBuffer("git", ["--git-dir", barePath, "cat-file", "blob", objectId], {
        cwd: dirname(barePath),
      })
    ).stdout;
    let text: string;
    try {
      text = decoder.decode(content);
    } catch {
      skippedNonTextBlobCount += 1;
      continue;
    }
    if (text.includes("\0")) {
      skippedNonTextBlobCount += 1;
      continue;
    }
    const destination = join(
      outputRoot,
      `${String(Object.keys(committed).length).padStart(4, "0")}-${objectId}.txt`,
    );
    await writeFile(destination, text, "utf8");
    committed[objectId] = destination;
  }

  return {
    committed,
    scan: {
      reachableObjectCount: reachableObjectIds.length,
      reachableBlobReferenceCount: referencedBlobIds.length,
      uniqueReachableBlobCount: blobIds.length,
      uniqueTextBlobCount: Object.keys(committed).length,
      repeatedTreeReferenceCount: referencedBlobIds.length - new Set(referencedBlobIds).size,
      skippedNonTextBlobCount,
    },
  };
}

async function observeOverlap(
  root: string,
  buildRoot: string,
  result: AttemptResult,
): Promise<Record<string, unknown>> {
  const overlapRoot = join(dirname(result.tracePath), "overlap-input");
  const manifest = requireBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const { committed, scan } = await collectCommittedFiles(
    result.frozen.barePath,
    join(overlapRoot, "git"),
  );
  const privateSources = Object.fromEntries(
    manifest.stages.map((stage) => [
      `${stage.agentId}-stage-${stage.ordinal}`,
      absoluteFrom(buildRoot, stage.sourcePath),
    ]),
  );
  const plaintextSources = {
    complete: join(buildRoot, manifest.oracleRoot, "plaintext.txt"),
  };
  const requestPath = join(overlapRoot, "request.json");
  await writeFile(
    requestPath,
    `${JSON.stringify({ committed, privateSources, plaintextSources, scan }, null, 2)}\n`,
    "utf8",
  );
  const overlap = await runPythonJson(root, "palimpsest.puzzle.overlap", [
    "--request",
    requestPath,
  ]);
  await writeFile(join(dirname(result.tracePath), "overlap.json"), `${JSON.stringify(overlap)}\n`);
  await appendTraceEvent(result.tracePath, "overlap.observed", overlap);
  return overlap;
}

export async function runPuzzle(options: RunPuzzleOptions): Promise<RunPuzzleResult> {
  const root = resolve(options.root);
  const buildRoot = resolve(options.buildRoot);
  const output = resolve(options.output);
  if (options.tokenBudget <= 0 || options.wallTimeMs <= 0) {
    throw new Error("Token budget and wall time must be positive.");
  }
  await mkdir(dirname(output), { recursive: true });
  const manifest = requireBuildManifest(await readJsonObject(join(buildRoot, "puzzle-build.json")));
  const stagesFor = (agentId: AgentId) =>
    manifest.stages
      .filter((stage) => stage.agentId === agentId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((stage) => absoluteFrom(buildRoot, stage.sourcePath));
  const agentStages: AttemptConfig["agentStages"] = {
    "agent-1": stagesFor("agent-1"),
    "agent-2": stagesFor("agent-2"),
    "agent-3": stagesFor("agent-3"),
  };
  const config: AttemptConfig = {
    attemptId: `attempt-${manifest.buildId.slice("build-".length, "build-".length + 16)}`,
    artifactRoot: output,
    buildPath: join(buildRoot, "puzzle-build.json"),
    referenceCorpusPath: absoluteFrom(buildRoot, manifest.referenceCorpusPath),
    agentStages,
    tokenBudgetPerAgent: options.tokenBudget,
    wallTimeMs: options.wallTimeMs,
    stageIntervalMs: manifest.stageIntervalMs,
    shutdownToleranceMs: 5_000,
  };
  let adapter: AgentAdapter;
  if (options.adapter === "fixture") {
    adapter = fixtureAdapter(options.fixtureScenario);
  } else {
    if (!options.model) throw new Error("--model is required for the live OpenAI adapter.");
    adapter = openAIAdapter(options.model);
  }
  const sandbox = await createDockerCommandSandbox({ root });
  const result = await runAttempt({
    config,
    adapter,
    checker: checkerHook(root, buildRoot),
    sandbox,
  });
  const overlap = await observeOverlap(root, buildRoot, result);
  await writeFile(
    join(output, "attempt.json"),
    `${JSON.stringify(
      {
        attemptId: result.attemptId,
        buildRoot,
        tracePath: result.tracePath,
        traceMetadataPath: result.traceMetadataPath,
        frozenRoot: result.frozen.root,
        sandbox: { ...result.sandbox, ...SANDBOX_POLICY },
        sessions: result.sessions,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { ...result, attemptRoot: output, buildRoot, overlap };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const adapter = requiredFlag(flags, "--adapter");
  if (adapter !== "fixture" && adapter !== "openai") {
    throw new Error("--adapter must be fixture or openai.");
  }
  const model = flags.get("--model");
  const fixtureScenario = flags.get("--fixture-scenario");
  const result = await runPuzzle({
    root: resolve("."),
    buildRoot: requiredFlag(flags, "--build"),
    output: requiredFlag(flags, "--output"),
    adapter,
    tokenBudget: integerFlag(flags, "--token-budget"),
    wallTimeMs: integerFlag(flags, "--wall-time-ms"),
    ...(model === undefined ? {} : { model }),
    ...(fixtureScenario === undefined ? {} : { fixtureScenario }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
