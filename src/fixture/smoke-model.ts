import type {
  AgentId,
  ModelAdapter,
  ModelSession,
  ModelSessionContext,
  ModelTurn,
} from "../model/contracts.js";

type FixtureScripts = Partial<Record<AgentId, readonly ModelTurn[]>>;
type FixtureScriptSource = FixtureScripts | ((context: ModelSessionContext) => FixtureScripts);

function copyTurn(turn: ModelTurn): ModelTurn {
  const common = {
    toolCalls: turn.toolCalls.map((call) => ({ ...call, arguments: { ...call.arguments } })),
    ...(turn.usage === undefined ? {} : { usage: { ...turn.usage } }),
    ...(turn.usageUnavailable === undefined ? {} : { usageUnavailable: true as const }),
  };
  return turn.finalResponse === undefined
    ? common
    : { ...common, finalResponse: turn.finalResponse };
}

export class FixtureModelAdapter implements ModelAdapter {
  readonly #scripts: FixtureScriptSource;
  readonly #repeatWait: boolean;

  constructor(scripts: FixtureScriptSource, repeatWait = false) {
    this.#scripts = scripts;
    this.#repeatWait = repeatWait;
  }

  static repeatingWait(): FixtureModelAdapter {
    return new FixtureModelAdapter({}, true);
  }

  openSession(context: ModelSessionContext): ModelSession {
    const scripts = typeof this.#scripts === "function" ? this.#scripts(context) : this.#scripts;
    const script = scripts[context.agentId] ?? [];
    let index = 0;
    return {
      respond: async () => {
        const turn = script[index];
        index += 1;
        if (turn !== undefined) return copyTurn(turn);
        if (this.#repeatWait) {
          return {
            toolCalls: [
              {
                id: `wait-${context.agentId}-${index}`,
                name: "wait_for_activity",
                arguments: { afterSequence: 0 },
              },
            ],
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        return {
          toolCalls: [],
          finalResponse: "Fixture script complete.",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
  }
}

export type FixtureScenario = "collaborative-revision";

export function decodeFixtureScenario(value?: string): FixtureScenario {
  if (value === undefined || value === "collaborative-revision") {
    return "collaborative-revision";
  }
  throw new Error(
    `Unknown fixture scenario ${JSON.stringify(value)}. Supported scenarios: collaborative-revision.`,
  );
}

function collaborativeRevisionScripts(
  checkerEnabled: boolean,
): Record<AgentId, readonly ModelTurn[]> {
  const solverCommand = [
    `printf '%s\\n' 'import os' 'from pathlib import Path' '' 'source = Path(os.environ["PALIMPSEST_CIPHERTEXT"])' 'destination = Path(os.environ["PALIMPSEST_OUTPUT"])' 'destination.write_text(source.read_text())' > solver.py`,
    "git add solver.py",
    "git commit -m 'improve fixture solver'",
    "git push origin HEAD:main",
  ].join(" && ");
  return {
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
            name: "wait_for_activity",
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
            name: "wait_for_activity",
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
    "agent-3": checkerEnabled
      ? [
          {
            toolCalls: [{ id: "check", name: "check_published_solver", arguments: {} }],
            usage: { inputTokens: 3, outputTokens: 2 },
          },
          {
            toolCalls: [],
            finalResponse: "Checked the published team solver.",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]
      : [
          {
            toolCalls: [
              {
                id: "inspect-without-checker",
                name: "run_command",
                arguments: { command: "git status --short" },
              },
            ],
            usage: { inputTokens: 3, outputTokens: 2 },
          },
          {
            toolCalls: [],
            finalResponse: "Inspected the workspace without checker feedback.",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ],
  };
}

export function createFixtureModelAdapter(scenario?: string): FixtureModelAdapter {
  switch (decodeFixtureScenario(scenario)) {
    case "collaborative-revision":
      return new FixtureModelAdapter((context) =>
        collaborativeRevisionScripts(
          context.tools.some(({ name }) => name === "check_published_solver"),
        ),
      );
  }
}
