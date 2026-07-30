import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ATTEMPT_CUTOFF_MS,
  CONDITION_IDS,
  RELEASE_OFFSETS_MS,
  resolveCondition,
  type ConditionId,
} from "./condition.js";
import { runGit } from "./git.js";
import type {
  AgentId,
  ModelAdapter,
  ModelBinding,
  ModelRequest,
  ModelToolResult,
} from "./model.js";
import type { PreflightReceipt } from "./preflight.js";
import type { MonotonicClock } from "./reveal.js";
import {
  runAttempt,
  runPuzzle,
  validateAttemptConfig,
  type AgentRuntimeBinding,
  type AttemptConfig,
} from "./run.js";
import {
  SandboxInfrastructureError,
  type AgentSandboxLease,
  type AgentSandboxLeaseRequest,
} from "./sandbox/contracts.js";
import { FakeCommandSandbox } from "./test-helpers.js";

const AGENTS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];
const STATIONARY_BUILD_ID = `build-${"b".repeat(64)}`;
const REKEY_BUILD_ID = `build-${"a".repeat(64)}`;

function model(index: number, provider = "fixture"): ModelBinding {
  const profile = `model-${String(index + 1)}`;
  return {
    profile,
    provider,
    driver: "openai-compatible",
    requestedModel: profile,
    settings: {},
    providerOptions: {},
  };
}

function runtimes(
  adapterFor: (agentId: AgentId) => ModelAdapter,
  provider = "fixture",
): Record<AgentId, AgentRuntimeBinding> {
  return Object.fromEntries(
    AGENTS.map((agentId, index) => [
      agentId,
      { model: model(index, provider), adapter: adapterFor(agentId) },
    ]),
  ) as Record<AgentId, AgentRuntimeBinding>;
}

class ControlledClock implements MonotonicClock {
  currentMs = 0;
  readonly deadlines: number[] = [];
  readonly #waiters = new Set<{
    deadlineMs: number;
    signal: AbortSignal;
    finish: (reached: boolean) => void;
  }>();

  nowMs(): number {
    return this.currentMs;
  }

  waitUntil(deadlineMs: number, signal: AbortSignal): Promise<boolean> {
    this.deadlines.push(deadlineMs);
    if (signal.aborted) return Promise.resolve(false);
    if (deadlineMs <= this.currentMs) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = {
        deadlineMs,
        signal,
        finish: (reached: boolean) => {
          signal.removeEventListener("abort", abort);
          this.#waiters.delete(waiter);
          resolve(reached);
        },
      };
      const abort = () => waiter.finish(false);
      signal.addEventListener("abort", abort, { once: true });
      this.#waiters.add(waiter);
    });
  }

  advanceTo(currentMs: number): void {
    if (currentMs < this.currentMs) throw new Error("Controlled clock cannot move backwards.");
    this.currentMs = currentMs;
    for (const waiter of this.#waiters) {
      if (waiter.deadlineMs <= currentMs) waiter.finish(true);
    }
  }
}

class StalledLeaseSandbox extends FakeCommandSandbox {
  override async openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease> {
    this.leases.push(request);
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (request.signal?.aborted) {
        abort();
        return;
      }
      request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(message);
}

async function fixtureConfig(root: string, condition: ConditionId = "CR"): Promise<AttemptConfig> {
  const resolved = resolveCondition(condition);
  const agentStages = Object.fromEntries(
    await Promise.all(
      AGENTS.map(async (agentId) => {
        const sourceRoot = join(root, "source", agentId);
        await mkdir(sourceRoot, { recursive: true });
        const stages = await Promise.all(
          Array.from({ length: 6 }, async (_, index) => {
            const ordinal = index + 1;
            const path = join(sourceRoot, `stage-${String(ordinal).padStart(2, "0")}.txt`);
            await writeFile(path, `${agentId}-${String(ordinal)}\n`, {
              encoding: "utf8",
              flag: "wx",
            });
            return path;
          }),
        );
        return [agentId, stages] as const;
      }),
    ),
  ) as Record<AgentId, readonly string[]>;
  const referenceCorpusPath = join(root, "reference");
  await mkdir(referenceCorpusPath);
  await writeFile(join(referenceCorpusPath, "reference.txt"), "reference\n", "utf8");
  return {
    attemptId: `attempt-${condition.toLowerCase()}-001`,
    studyPhase: "standalone",
    monetaryAuthorizationCeilingCents: 0,
    blockId: "calibration-theron-ware",
    condition,
    buildId: resolved.variantId === "stationary" ? STATIONARY_BUILD_ID : REKEY_BUILD_ID,
    artifactRoot: join(root, "attempt"),
    buildRoot: join(root, "build"),
    referenceCorpusPath,
    agentIds: AGENTS,
    agentStages,
    releaseOffsetsMs: RELEASE_OFFSETS_MS,
    cutoffMs: ATTEMPT_CUTOFF_MS,
    tokenBudgetPerAgent: 100,
    teamChannel: "disabled",
  };
}

function finishAdapter(finalResponse = "done"): ModelAdapter {
  return {
    openSession: () => ({
      respond: async () => ({
        toolCalls: [],
        finalResponse,
        usage: { inputTokens: 2, outputTokens: 1 },
      }),
    }),
  };
}

function waitingAdapter(): ModelAdapter {
  return {
    openSession: () => {
      let cursor = 1;
      return {
        respond: async (request) => {
          const output = request.toolResults[0]?.output;
          if (
            typeof output === "object" &&
            output !== null &&
            "sequence" in output &&
            typeof output.sequence === "number"
          ) {
            cursor = output.sequence;
          }
          return {
            toolCalls: [
              {
                id: `wait-${String(cursor)}`,
                name: "wait_for_activity",
                arguments: { afterSequence: cursor },
              },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      };
    },
  };
}

function waitOnceAdapter(results: Map<AgentId, unknown>): ModelAdapter {
  return {
    openSession: ({ agentId }) => {
      let waiting = false;
      return {
        respond: async (request: ModelRequest) => {
          if (!waiting) {
            waiting = true;
            return {
              toolCalls: [
                {
                  id: `wait-${agentId}`,
                  name: "wait_for_activity",
                  arguments: { afterSequence: 1 },
                },
              ],
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          }
          results.set(agentId, request.toolResults[0]?.output);
          return {
            toolCalls: [],
            finalResponse: "activity observed",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      };
    },
  };
}

async function publishAgentOneRef(config: AttemptConfig): Promise<void> {
  const workspace = join(config.artifactRoot, "git", "workspaces", "agent-1");
  const mode = resolveCondition(config.condition).communicationMode;
  const repository = join(
    config.artifactRoot,
    "git",
    mode === "shared" ? "shared.git" : "agent-1.git",
  );
  await runGit(["switch", "--orphan", "activity/agent-one"], workspace);
  await writeFile(join(workspace, "activity.txt"), "agent one\n", "utf8");
  await runGit(["add", "activity.txt"], workspace);
  await runGit(["commit", "-m", "publish activity"], workspace);
  await runGit(["push", repository, "HEAD:refs/heads/activity/agent-one"], workspace);
}

function activityOutput(
  results: Map<AgentId, unknown>,
  agentId: AgentId,
): ModelToolResult["output"] {
  return results.get(agentId);
}

describe("fixed four-condition run coordinator", () => {
  it.each(CONDITION_IDS)(
    "derives the %s treatment and freezes its native repository topology",
    async (condition) => {
      const root = await mkdtemp(join(tmpdir(), `palimpsest-run-${condition.toLowerCase()}-`));
      const config = await fixtureConfig(root, condition);
      const clock = new ControlledClock();
      const sandbox = new FakeCommandSandbox();
      const expected = resolveCondition(condition);

      expect(validateAttemptConfig(config)).toEqual(config);
      const result = await runAttempt({
        config,
        agents: runtimes(() => finishAdapter()),
        sandbox,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        clock,
      });

      expect(result).toMatchObject({
        studyPhase: "standalone",
        monetaryAuthorizationCeilingCents: 0,
        blockId: "calibration-theron-ware",
        condition,
        communicationMode: expected.communicationMode,
        keyRegime: expected.keyRegime,
        variantId: expected.variantId,
        buildId: config.buildId,
        releaseOffsetsMs: RELEASE_OFFSETS_MS,
        cutoffMs: ATTEMPT_CUTOFF_MS,
        tokenBudgetPerAgent: 100,
      });
      expect(result.frozen).toMatchObject({
        communicationMode: expected.communicationMode,
        frozen: true,
      });
      expect(result.frozen.repositories).toHaveLength(
        expected.communicationMode === "shared" ? 1 : 3,
      );
      expect(result.frozen.workspaces).toHaveLength(3);
      expect(new Set(sandbox.leases.map(({ gitOriginPath }) => gitOriginPath)).size).toBe(
        expected.communicationMode === "shared" ? 1 : 3,
      );
      expect(sandbox.closedLeases).toBe(3);
    },
  );

  it.each([
    ["CS", true],
    ["IS", false],
  ] as const)(
    "makes direct team discussion available in %s only when the condition is shared",
    async (condition, channelVisible) => {
      const root = await mkdtemp(
        join(tmpdir(), `palimpsest-run-channel-${condition.toLowerCase()}-`),
      );
      const config = { ...(await fixtureConfig(root, condition)), teamChannel: "enabled" as const };
      const toolNames = new Map<AgentId, readonly string[]>();
      const agents = runtimes((agentId) => ({
        openSession: ({ tools }) => {
          toolNames.set(
            agentId,
            tools.map(({ name }) => name),
          );
          let turn = 0;
          return {
            respond: async () => {
              turn += 1;
              if (agentId === "agent-1" && channelVisible && turn === 1) {
                return {
                  toolCalls: [
                    {
                      id: "message-1",
                      name: "post_team_message",
                      arguments: { message: "Compare the repeated-word hypothesis." },
                    },
                  ],
                  usage: { inputTokens: 1, outputTokens: 1 },
                };
              }
              return {
                toolCalls: [],
                finalResponse: "done",
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            },
          };
        },
      }));

      const result = await runAttempt({
        config,
        agents,
        sandbox: new FakeCommandSandbox(),
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        clock: new ControlledClock(),
      });

      for (const names of toolNames.values()) {
        expect(names.includes("post_team_message")).toBe(channelVisible);
        expect(names.includes("read_team_messages")).toBe(channelVisible);
      }
      const events = (await readFile(result.tracePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { kind: string; data: unknown });
      const messages = events.filter(({ kind }) => kind === "team.message");
      expect(messages).toHaveLength(channelVisible ? 1 : 0);
      if (channelVisible) {
        expect(messages[0]?.data).toMatchObject({
          sequence: 1,
          author: "agent-1",
          message: "Compare the repeated-word hypothesis.",
        });
      }
    },
  );

  it("rejects condition, geometry, and schedule drift before creating an attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-invalid-"));
    const config = await fixtureConfig(root);
    const cases: Array<[unknown, RegExp]> = [
      [{ ...config, condition: "cr" }, /Condition must be exactly/],
      [{ ...config, agentIds: ["agent-1", "agent-2"] }, /exactly three/i],
      [
        {
          ...config,
          agentStages: {
            ...config.agentStages,
            "agent-3": config.agentStages["agent-3"]!.slice(0, 5),
          },
        },
        /exactly 6 stages/i,
      ],
      [{ ...config, releaseOffsetsMs: [0, 1, 2, 3, 4, 5] }, /releaseOffsetsMs|fixed/i],
      [{ ...config, cutoffMs: ATTEMPT_CUTOFF_MS - 1 }, /cutoffMs|fixed/i],
      [{ ...config, tokenBudgetPerAgent: 0 }, /tokenBudgetPerAgent/],
      [{ ...config, teamChannel: "sometimes" }, /teamChannel/],
    ];

    for (const [value, message] of cases) {
      expect(() => validateAttemptConfig(value)).toThrow(message);
    }
    expect(config).not.toHaveProperty("maxTurns");
    expect(config).not.toHaveProperty("maxGitBytes");
    expect(config).not.toHaveProperty("wallTimeMs");
    expect(config).not.toHaveProperty("stageIntervalMs");
  });

  it.each([
    ["studyRootId", "study-fixture"],
    ["conditionOrderPosition", 1],
    ["designDigest", "a".repeat(64)],
  ] as const)("forbids standalone study receipt field %s", async (field, value) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-standalone-provenance-"));
    const config = await fixtureConfig(root);

    expect(() => validateAttemptConfig({ ...config, [field]: value })).toThrow(
      "Standalone attempts cannot carry study receipt provenance.",
    );
  });

  it("requires complete receipt provenance for study attempts and forbids standalone lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-study-provenance-"));
    const config = await fixtureConfig(root);
    const studyConfig = {
      ...config,
      studyPhase: "validation",
      studyRootId: "study-fixture",
      conditionOrderPosition: 2,
      designDigest: "a".repeat(64),
    } as const;

    expect(validateAttemptConfig(studyConfig)).toMatchObject({
      studyPhase: "validation",
      studyRootId: "study-fixture",
      conditionOrderPosition: 2,
      designDigest: "a".repeat(64),
      monetaryAuthorizationCeilingCents: 0,
    });
    expect(() =>
      validateAttemptConfig({
        ...config,
        replacementOfAttemptId: "attempt-source",
      }),
    ).toThrow("Standalone attempts cannot replace study attempts.");
  });

  it("publishes each first private stage before opening model sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-initial-stage-"));
    const config = await fixtureConfig(root);
    const opened: AgentId[] = [];
    const adapter: ModelAdapter = {
      async openSession({ agentId }) {
        const evidence = await readdir(join(config.artifactRoot, "private-evidence", agentId));
        expect(evidence).toEqual(["stage-01-stage-01.txt"]);
        opened.push(agentId);
        return finishAdapter().openSession({ agentId, tools: [] });
      },
    };

    const result = await runAttempt({
      config,
      agents: runtimes(() => adapter),
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: new ControlledClock(),
    });

    expect(opened.sort()).toEqual([...AGENTS]);
    expect(result.sessions.every(({ state }) => state === "finished")).toBe(true);
  });

  it.each([
    ["CR", "shared"],
    ["IR", "isolated"],
  ] as const)(
    "exposes %s Git activity according to the %s topology without hidden sequence gaps",
    async (condition, communicationMode) => {
      const root = await mkdtemp(join(tmpdir(), `palimpsest-run-activity-${condition}-`));
      const config = await fixtureConfig(root, condition);
      const clock = new ControlledClock();
      const sandbox = new FakeCommandSandbox();
      const results = new Map<AgentId, unknown>();
      const adapter = waitOnceAdapter(results);
      const attempt = runAttempt({
        config,
        agents: runtimes(() => adapter),
        sandbox,
        checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
        clock,
        gitPollIntervalMs: 1,
      });

      await waitForCondition(
        () => sandbox.leases.length === 3,
        "Agent leases did not open before Git activity.",
      );
      await publishAgentOneRef(config);
      await waitForCondition(
        () => results.has("agent-1"),
        "Agent 1 did not observe its visible Git activity.",
      );

      if (communicationMode === "shared") {
        await waitForCondition(
          () => results.size === 3,
          "Peers did not observe shared Git activity.",
        );
        for (const agentId of AGENTS) {
          expect(activityOutput(results, agentId)).toMatchObject({
            sequence: 2,
            kind: "git-changed",
          });
        }
      } else {
        expect(results.has("agent-2")).toBe(false);
        expect(results.has("agent-3")).toBe(false);
        expect(activityOutput(results, "agent-1")).toMatchObject({
          sequence: 2,
          kind: "git-changed",
        });
        clock.advanceTo(RELEASE_OFFSETS_MS[1]);
        await waitForCondition(
          () => results.size === 3,
          "Private stage activity did not resume isolated peers.",
        );
        for (const agentId of ["agent-2", "agent-3"] as const) {
          expect(activityOutput(results, agentId)).toMatchObject({
            sequence: 2,
            kind: "stage-released",
          });
        }
      }

      const result = await attempt;
      expect(result.frozen.communicationMode).toBe(communicationMode);
    },
  );

  it("stops active sessions at the fixed 60-minute cutoff using monotonic time", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-cutoff-"));
    const config = await fixtureConfig(root);
    const clock = new ControlledClock();
    const sandbox = new FakeCommandSandbox();
    const attempt = runAttempt({
      config,
      agents: runtimes(() => waitingAdapter()),
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock,
    });

    await waitForCondition(
      () => sandbox.leases.length === 3,
      "Agent leases did not open before the cutoff.",
    );
    clock.advanceTo(ATTEMPT_CUTOFF_MS);
    const result = await attempt;

    expect(clock.deadlines).toContain(ATTEMPT_CUTOFF_MS);
    expect(result.sessions.every(({ state }) => state === "time-exhausted")).toBe(true);
    expect(sandbox.closedLeases).toBe(3);
  });

  it("copies preflight provenance before opening provider-backed sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-preflight-"));
    const config = await fixtureConfig(root);
    const preflight: PreflightReceipt = {
      schemaVersion: 1,
      testedCommit: "a".repeat(40),
      sourceClean: true,
      completedAt: "2026-07-28T12:00:00.000Z",
      sandbox: new FakeCommandSandbox().identity,
    };
    const adapter: ModelAdapter = {
      openSession: () => ({
        async respond() {
          expect(
            JSON.parse(await readFile(join(config.artifactRoot, "preflight.json"), "utf8")),
          ).toEqual(preflight);
          return {
            toolCalls: [],
            finalResponse: "ready",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      }),
    };

    await runAttempt({
      config,
      agents: runtimes(() => adapter, "provider"),
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: new ControlledClock(),
      preflight,
    });
  });

  it("rejects provider-backed sessions before output when preflight is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-missing-preflight-"));
    const output = join(root, "attempt");
    let opened = false;
    const agents = runtimes(
      () => ({
        openSession() {
          opened = true;
          return finishAdapter().openSession({ agentId: "agent-1", tools: [] });
        },
      }),
      "provider",
    );

    await expect(
      runPuzzle({
        root,
        buildRoot: join(root, "unused-build"),
        output,
        studyPhase: "standalone",
        monetaryAuthorizationCeilingCents: 0,
        condition: "CR",
        agents,
        tokenBudgetPerAgent: 100,
        teamChannel: "disabled",
        sandbox: new FakeCommandSandbox(),
        clock: new ControlledClock(),
      }),
    ).rejects.toThrow(/preflight receipt is missing or invalid/i);
    expect(opened).toBe(false);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds stalled lease setup by the fixed cutoff without a real-time wait", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-lease-cutoff-"));
    const config = await fixtureConfig(root);
    const clock = new ControlledClock();
    const sandbox = new StalledLeaseSandbox();
    const attempt = runAttempt({
      config,
      agents: runtimes(() => waitingAdapter()),
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock,
    });

    await waitForCondition(() => sandbox.leases.length === 3, "Stalled leases were not requested.");
    clock.advanceTo(ATTEMPT_CUTOFF_MS);
    await expect(attempt).rejects.toThrow(
      "Attempt wall-time cutoff expired during agent sandbox setup.",
    );
    expect(sandbox.leases.every(({ timeoutMs }) => timeoutMs > 0 && timeoutMs <= 30_000)).toBe(
      true,
    );
  });

  it("closes every opened lease when a later stage cannot be published", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-stage-cleanup-"));
    const config = await fixtureConfig(root);
    await rm(config.agentStages["agent-1"]![1]!);
    const clock = new ControlledClock();
    const sandbox = new FakeCommandSandbox();
    const attempt = runAttempt({
      config,
      agents: runtimes(() => waitingAdapter()),
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock,
    });

    await waitForCondition(
      () => sandbox.leases.length === 3,
      "Agent leases did not open before stage publication.",
    );
    clock.advanceTo(RELEASE_OFFSETS_MS[1]);
    await Promise.resolve();
    clock.advanceTo(ATTEMPT_CUTOFF_MS);
    await expect(attempt).rejects.toThrow();
    expect(sandbox.closedLeases).toBe(3);
  });

  it("records provider and command-sandbox failures without losing native frozen work", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-session-failures-"));
    const config = await fixtureConfig(root, "IR");
    const adapter: ModelAdapter = {
      openSession({ agentId }) {
        if (agentId === "agent-1") throw new Error("provider unavailable");
        let called = false;
        return {
          respond: async () => {
            if (agentId === "agent-2" && !called) {
              called = true;
              return {
                toolCalls: [{ id: "command", name: "run_command", arguments: { command: "true" } }],
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            }
            return {
              toolCalls: [],
              finalResponse: "done",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    };
    const sandbox = new FakeCommandSandbox(async () => {
      throw new SandboxInfrastructureError("Docker daemon unavailable.");
    });

    const result = await runAttempt({
      config,
      agents: runtimes(() => adapter),
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: new ControlledClock(),
    });

    expect(result.sessions.find(({ agentId }) => agentId === "agent-1")).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "provider unavailable",
    });
    expect(result.sessions.find(({ agentId }) => agentId === "agent-2")).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "Docker daemon unavailable.",
    });
    expect(result.frozen).toMatchObject({
      communicationMode: "isolated",
      frozen: true,
    });
    expect(result.frozen.repositories).toHaveLength(3);
    expect(sandbox.closedLeases).toBe(3);
  });
});
