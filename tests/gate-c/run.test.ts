import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import type { MonotonicClock } from "../../tools/gate-c/config.js";
import { replayGateC } from "../../tools/gate-c/replay.js";
import {
  buildGateCPredeclaration,
  completeGateCFrom,
  verifyTerminalAttempt,
} from "../../tools/gate-c/report.js";
import { executeGateCAttempt, type AttemptEnvironment } from "../../tools/gate-c/run.js";
import {
  type ContainerReceipt,
  OpenAIRequestError,
  type ResponseRequest,
  type SolverApiClient,
  type UploadReceipt,
} from "../../tools/gate-c/solver-runner.js";

const execFileAsync = promisify(execFile);
const predeclared = buildGateCPredeclaration([
  {
    artifactType: "gate-c-test-input",
    byteLength: 1,
    sha256: "a".repeat(64),
  },
]);
const declarationDigest = String(predeclared.predeclarationDigest);
const environment: AttemptEnvironment = {
  git: "2.48.1",
  node: "26.5.0",
  pnpm: "10.14.0",
  python: "3.12.4",
  uv: "0.11.14",
  platform: "test-fixture",
  revision: "b".repeat(40),
};

class FakeClock implements MonotonicClock {
  currentMs = 1_000;

  nowMs(): number {
    return this.currentMs;
  }

  async waitUntil(targetMs: number): Promise<void> {
    this.currentMs = Math.max(this.currentMs, targetMs);
  }
}

class FakeClient implements SolverApiClient {
  readonly actions: string[];
  readonly requests: ResponseRequest[] = [];

  constructor(actions: string[]) {
    this.actions = actions;
  }

  async createContainer(): Promise<ContainerReceipt> {
    this.actions.push("container");
    return { id: "cntr_run", networkPolicy: "disabled" };
  }

  async downloadFile(): Promise<Uint8Array> {
    throw new Error("fixture has no solver-created files");
  }

  async uploadFile(
    containerId: string,
    filename: string,
    content: Uint8Array,
  ): Promise<UploadReceipt> {
    return {
      bytes: content.byteLength,
      containerId,
      id: `file_${filename}`,
      path: `/mnt/data/${filename}`,
    };
  }

  async *streamResponse(request: ResponseRequest) {
    this.requests.push(request);
    const ordinal = this.requests.length;
    yield {
      type: "response.output_item.added",
      item: { type: "code_interpreter_call" },
    };
    yield {
      type: "response.output_text.delta",
      delta: JSON.stringify({
        mappings: [
          {
            cipherType: `cipher-${ordinal}`,
            plainType: `plain-${ordinal}`,
            confidence: 0.8,
            status: "active",
            supportingRevealOrdinals: [ordinal],
            rationale: "full-run fixture",
          },
        ],
        switchHypotheses:
          ordinal === 5
            ? [{ afterChapter: 12, confidence: 0.8, evidence: "fixture evidence" }]
            : [],
        reconstructionRefs: [],
      }),
    };
    yield {
      type: "response.completed",
      response: {
        id: `resp_${ordinal}`,
        usage: { input_tokens: 10, output_tokens: 5 },
        output: [],
      },
    };
  }
}

async function gateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-gate-c-run-"));
  await cp("artifacts/gate-c/declared", join(root, "declared"), {
    recursive: true,
  });
  return root;
}

async function executeFixture(root: string, runId: string, actions: string[]) {
  return executeGateCAttempt({
    client: new FakeClient(actions),
    clock: new FakeClock(),
    environment,
    gateCRoot: root,
    identity: { declarationDigest, runId },
    onAttemptCreated: () => {
      actions.push("announced");
    },
    startedAt: "2026-07-26T00:00:00Z",
  });
}

describe("Gate C full operator path", () => {
  test("runs, scores, replays, and isolates six released chapters", async () => {
    const root = await gateRoot();
    const actions: string[] = [];
    const first = await executeFixture(root, "run-1", actions);
    expect(actions.slice(0, 2)).toEqual(["announced", "container"]);

    const current = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
    expect(current).toMatchObject({
      attemptId: `gate-c/${declarationDigest}/run-1`,
      status: "solver-completed",
      evidence: false,
    });
    const events = JSON.parse(await readFile(join(first, "reveal-events.json"), "utf8"));
    const checkpoints = JSON.parse(await readFile(join(first, "checkpoints.json"), "utf8"));
    expect(events).toHaveLength(6);
    expect(checkpoints).toHaveLength(6);
    expect(events.map((event: { observedOffsetMs: number }) => event.observedOffsetMs)).toEqual([
      0, 120_000, 240_000, 360_000, 480_000, 600_000,
    ]);

    await execFileAsync("uv", [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.gate_c.score_attempt",
      "--declaration-digest",
      declarationDigest,
      "--run-id",
      "run-1",
      "--attempts-root",
      join(root, "attempts"),
    ]);
    const terminal = JSON.parse(await readFile(join(first, "terminal.json"), "utf8"));
    expect(terminal).toMatchObject({
      attemptId: `gate-c/${declarationDigest}/run-1`,
      status: "scored",
      model: "gpt-5.6-sol",
      containerId: "cntr_run",
    });
    expect(terminal.outputs.map((entry: { path: string }) => entry.path)).not.toContain(
      "terminal.json",
    );
    await expect(
      verifyTerminalAttempt(first, `gate-c/${declarationDigest}/run-1`),
    ).resolves.toMatchObject({ status: "scored" });
    expect(
      JSON.parse(
        await replayGateC([
          "--declaration-digest",
          declarationDigest,
          "--run-id",
          "run-1",
          "--attempts-root",
          join(root, "attempts"),
        ]),
      ),
    ).toMatchObject({
      attemptId: `gate-c/${declarationDigest}/run-1`,
      classification: "stop",
      checkpointCount: 6,
    });
    await completeGateCFrom({
      gateRoot: root,
      identity: { declarationDigest, runId: "run-1" },
      predeclared,
    });
    expect(JSON.parse(await readFile(join(root, "milestone-report.json"), "utf8"))).toMatchObject({
      decision: "stop",
      authorization: {
        gateDAuthorization: "none",
        fullHarnessAuthorized: false,
      },
    });

    const firstBeforeRetry = await readFile(join(first, "terminal.json"));
    await executeFixture(root, "run-2", []);
    const firstAfterRetry = await readFile(join(first, "terminal.json"));
    expect(firstAfterRetry).toEqual(firstBeforeRetry);
    await expect(
      replayGateC([
        "--declaration-digest",
        declarationDigest,
        "--run-id",
        "run-1",
        "--attempts-root",
        join(root, "attempts"),
      ]),
    ).resolves.toContain('"classification":"stop"');
  }, 30_000);

  test("seals a failed attempt and refuses the same run identity", async () => {
    class QuotaClient extends FakeClient {
      override async createContainer(): Promise<ContainerReceipt> {
        throw new OpenAIRequestError("quota exhausted", 429, "insufficient_quota");
      }
    }
    const root = await gateRoot();
    const identity = { declarationDigest, runId: "failed-run" };
    const dependencies = {
      client: new QuotaClient([]),
      clock: new FakeClock(),
      environment,
      gateCRoot: root,
      identity,
      startedAt: "2026-07-26T00:00:00Z",
    };
    await expect(executeGateCAttempt(dependencies)).rejects.toMatchObject({
      code: "insufficient_quota",
    });
    const attempt = join(root, "attempts", declarationDigest, identity.runId);
    const terminalBeforeRetry = await readFile(join(attempt, "terminal.json"));
    expect(JSON.parse(terminalBeforeRetry.toString("utf8"))).toMatchObject({
      attemptId: `gate-c/${declarationDigest}/failed-run`,
      status: "failed",
      failure: { code: "insufficient_quota" },
    });
    await expect(executeGateCAttempt(dependencies)).rejects.toThrow();
    expect(await readFile(join(attempt, "terminal.json"))).toEqual(terminalBeforeRetry);
  });

  test("rejects trusted reveal timing drift before terminal scoring", async () => {
    const root = await gateRoot();
    const attempt = await executeFixture(root, "timing-drift", []);
    const eventsPath = join(attempt, "reveal-events.json");
    const events = JSON.parse(await readFile(eventsPath, "utf8"));
    events[1].observedOffsetMs = 119_000;
    await writeFile(eventsPath, JSON.stringify(events));
    await expect(
      execFileAsync("uv", [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.gate_c.score_attempt",
        "--declaration-digest",
        declarationDigest,
        "--run-id",
        "timing-drift",
        "--attempts-root",
        join(root, "attempts"),
      ]),
    ).rejects.toThrow("ordering does not match");
  });
});
