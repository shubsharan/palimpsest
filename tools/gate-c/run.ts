import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex, validateValue } from "@palimpsest/contracts";

import { readActualToolVersions, type ToolVersionMap } from "../evidence/verify-versions.js";
import { SystemMonotonicClock } from "./clock.js";
import {
  type GateCAttemptIdentity,
  FRONTIER_MODEL,
  type MonotonicClock,
  REVEAL_EARLY_TOLERANCE_MS,
  REVEAL_LATE_TOLERANCE_MS,
} from "./config.js";
import { checkGateCPredeclaration } from "./report.js";
import {
  OpenAIHttpClient,
  OpenAIRequestError,
  runSolverAttempt,
  type SolverApiClient,
  type SolverRelease,
} from "./solver-runner.js";

const defaultGateCRoot = "artifacts/gate-c";
const execFileAsync = promisify(execFile);

export interface AttemptEnvironment extends ToolVersionMap {
  platform: string;
  revision: string;
}

export interface GateCRunDependencies {
  client: SolverApiClient;
  clock: MonotonicClock;
  environment: AttemptEnvironment;
  gateCRoot: string;
  identity: GateCAttemptIdentity;
  onAttemptCreated?(attemptPath: string): void | Promise<void>;
  startedAt: string;
}

function newRunId(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .toLowerCase();
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = join(
    resolve(path, ".."),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  await writeFile(temporary, canonicalJsonBytes(value));
  await rename(temporary, path);
}

async function writeCurrentPointer(options: {
  attemptPath: string;
  gateCRoot: string;
  identity: GateCAttemptIdentity;
  startedAt: string;
  status: "running" | "solver-completed" | "failed";
}): Promise<void> {
  const { attemptPath, gateCRoot, identity, startedAt, status } = options;
  await atomicJson(join(gateCRoot, "current.json"), {
    schemaVersion: 1,
    attemptId: `gate-c/${identity.declarationDigest}/${identity.runId}`,
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    attemptPath,
    startedAt,
    status,
    evidence: false,
  });
}

async function copyDeclaredInputs(gateCRoot: string, attemptPath: string): Promise<void> {
  const inputRoot = join(attemptPath, "inputs");
  await mkdir(join(inputRoot, "chapters"), { recursive: true });
  for (const name of ["private-instance.json", "public-instance.json", "reveal-plan.json"]) {
    await copyFile(join(gateCRoot, "declared", name), join(inputRoot, name));
  }
  for (const name of ["changed-entries.json", "matched-controls.json"]) {
    await copyFile(join(gateCRoot, "declared", "sealed", name), join(inputRoot, name));
  }
  for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
    const name = `${String(ordinal).padStart(2, "0")}.txt`;
    await copyFile(
      join(gateCRoot, "declared", "public", "chapters", name),
      join(inputRoot, "chapters", name),
    );
  }
}

async function listAttemptOutputs(root: string, current = root): Promise<string[]> {
  const outputs: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    if (name === "terminal.json") {
      continue;
    }
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      outputs.push(...(await listAttemptOutputs(root, path)));
    } else if (metadata.isFile()) {
      outputs.push(relative(root, path).split(sep).join("/"));
    }
  }
  return outputs.sort();
}

async function outputEntries(attemptPath: string) {
  return Promise.all(
    (await listAttemptOutputs(attemptPath)).map(async (path) => {
      const bytes = await readFile(join(attemptPath, path));
      return { path, byteLength: bytes.length, sha256: sha256Hex(bytes) };
    }),
  );
}

async function finalizeFailedAttempt(options: {
  attemptPath: string;
  environment: AttemptEnvironment;
  error: unknown;
  gateCRoot: string;
  identity: GateCAttemptIdentity;
  startedAt: string;
}): Promise<void> {
  const { attemptPath, environment, error, gateCRoot, identity, startedAt } = options;
  await atomicJson(join(attemptPath, "terminal.json"), {
    schemaVersion: 1,
    attemptId: `gate-c/${identity.declarationDigest}/${identity.runId}`,
    declarationDigest: identity.declarationDigest,
    runId: identity.runId,
    startedAt,
    status: "failed",
    model: FRONTIER_MODEL,
    environment,
    failure: {
      type: error instanceof OpenAIRequestError ? "openai-request" : "trusted-runner",
      status: error instanceof OpenAIRequestError ? error.status : null,
      code: error instanceof OpenAIRequestError ? error.code : null,
      message: error instanceof Error ? error.message : "Unknown runner failure.",
    },
    outputs: await outputEntries(attemptPath),
  });
  await writeCurrentPointer({
    attemptPath,
    gateCRoot,
    identity,
    startedAt,
    status: "failed",
  });
}

export async function executeGateCAttempt(dependencies: GateCRunDependencies): Promise<string> {
  const { client, clock, environment, gateCRoot, identity, startedAt } = dependencies;
  const attemptId = `gate-c/${identity.declarationDigest}/${identity.runId}`;
  const attemptPath = join(gateCRoot, "attempts", identity.declarationDigest, identity.runId);
  await mkdir(join(gateCRoot, "attempts", identity.declarationDigest), {
    recursive: true,
  });
  await mkdir(attemptPath, { recursive: false });
  try {
    await mkdir(join(attemptPath, "reveal-events"), { recursive: false });
    await copyDeclaredInputs(gateCRoot, attemptPath);
    await writeFile(
      join(attemptPath, "attempt.json"),
      canonicalJsonBytes({
        schemaVersion: 1,
        attemptId,
        declarationDigest: identity.declarationDigest,
        runId: identity.runId,
        startedAt,
        model: FRONTIER_MODEL,
        environment,
        phase: "running",
      }),
      { flag: "wx" },
    );
    await writeCurrentPointer({
      attemptPath,
      gateCRoot,
      identity,
      startedAt,
      status: "running",
    });
    await dependencies.onAttemptCreated?.(attemptPath);

    const plan = JSON.parse(
      await readFile(join(attemptPath, "inputs/reveal-plan.json"), "utf8"),
    ) as {
      slots: Array<{
        chapterIndex: number;
        cipherChapterArtifact: {
          artifactType: string;
          byteLength: number;
          sha256: string;
        };
        ordinal: number;
        plannedOffsetMs: number;
      }>;
    };
    const planVerdict = validateValue("reveal-plan", plan);
    if (!planVerdict.accepted) {
      throw new Error(`Reveal plan is invalid: ${planVerdict.reason} at ${planVerdict.pointer}.`);
    }
    const events: Record<string, unknown>[] = [];

    async function* releases(): AsyncIterable<SolverRelease> {
      const startMs = clock.nowMs();
      for (const slot of plan.slots) {
        await clock.waitUntil(startMs + slot.plannedOffsetMs);
        const observedOffsetMs = Math.round(clock.nowMs() - startMs);
        if (
          observedOffsetMs < slot.plannedOffsetMs - REVEAL_EARLY_TOLERANCE_MS ||
          observedOffsetMs > slot.plannedOffsetMs + REVEAL_LATE_TOLERANCE_MS
        ) {
          throw new Error(`Reveal ${slot.ordinal} missed its declared timing tolerance.`);
        }
        const filename = `${String(slot.ordinal).padStart(2, "0")}.txt`;
        const content = await readFile(join(attemptPath, "inputs/chapters", filename));
        if (
          content.byteLength !== slot.cipherChapterArtifact.byteLength ||
          sha256Hex(content) !== slot.cipherChapterArtifact.sha256
        ) {
          throw new Error(`Declared chapter ${slot.ordinal} failed its artifact reference.`);
        }
        const event = {
          schemaVersion: 1,
          contractId: "reveal-event",
          attemptId,
          ordinal: slot.ordinal,
          chapterIndex: slot.chapterIndex,
          plannedOffsetMs: slot.plannedOffsetMs,
          observedOffsetMs,
          chapterArtifact: slot.cipherChapterArtifact,
        };
        const verdict = validateValue("reveal-event", event);
        if (!verdict.accepted) {
          throw new Error(`Reveal event is invalid: ${verdict.reason} at ${verdict.pointer}.`);
        }
        events.push(event);
        await writeFile(
          join(attemptPath, "reveal-events", `${slot.ordinal}.json`),
          canonicalJsonBytes(event),
        );
        await appendFile(
          join(attemptPath, "live.jsonl"),
          Buffer.concat([
            canonicalJsonBytes({
              schemaVersion: 1,
              recordedAt: new Date().toISOString(),
              revealOrdinal: slot.ordinal,
              type: "reveal.released",
              observedOffsetMs,
            }),
            Buffer.from("\n"),
          ]),
        );
        yield {
          content,
          filename,
          ordinal: slot.ordinal,
          observedMonotonicMs: observedOffsetMs,
        };
      }
    }

    const checkpoints = await runSolverAttempt({
      attemptPath,
      client,
      identity,
      releases: releases(),
    });
    await writeFile(join(attemptPath, "reveal-events.json"), canonicalJsonBytes(events));
    await writeFile(
      join(attemptPath, "solver-completion.json"),
      canonicalJsonBytes({
        schemaVersion: 1,
        attemptId,
        status: "solver-completed",
        model: FRONTIER_MODEL,
        containerId: checkpoints[0]?.containerId,
        responseChain: checkpoints.map((checkpoint) => checkpoint.responseId),
        checkpointCount: checkpoints.length,
      }),
    );
    await writeCurrentPointer({
      attemptPath,
      gateCRoot,
      identity,
      startedAt,
      status: "solver-completed",
    });
    return attemptPath;
  } catch (error) {
    const eventsPath = join(attemptPath, "reveal-events.json");
    try {
      await readFile(eventsPath);
    } catch {
      await writeFile(eventsPath, canonicalJsonBytes([]));
    }
    await finalizeFailedAttempt({
      attemptPath,
      environment,
      error,
      gateCRoot,
      identity,
      startedAt,
    });
    throw error;
  }
}

export async function runGateC(): Promise<string> {
  const declaration = await checkGateCPredeclaration();
  const declarationDigest = String(declaration.predeclarationDigest);
  const admission = JSON.parse(
    await readFile(join(defaultGateCRoot, "admission.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    admission.admitted !== true ||
    admission.declarationDigest !== declarationDigest ||
    admission.model !== FRONTIER_MODEL
  ) {
    throw new Error("Gate C admission does not authorize this declaration and model.");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not available.");
  }
  const versions = await readActualToolVersions();
  const { stdout: revision } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const identity = { declarationDigest, runId: newRunId() };
  const attemptPath = await executeGateCAttempt({
    client: new OpenAIHttpClient(apiKey),
    clock: new SystemMonotonicClock(),
    environment: {
      ...versions,
      platform: `${process.platform}-${process.arch}`,
      revision: revision.trim(),
    },
    gateCRoot: defaultGateCRoot,
    identity,
    onAttemptCreated: (path) => {
      process.stdout.write(`${path}\n`);
    },
    startedAt: new Date().toISOString(),
  });
  return attemptPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runGateC();
}
