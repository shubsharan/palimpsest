import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import { runProcess, type ProcessResult } from "../process.js";
import {
  SANDBOX_IMAGE_TAG,
  SANDBOX_PATHS,
  SANDBOX_POLICY,
  SandboxInfrastructureError,
  type AgentSandboxLease,
  type AgentSandboxLeaseRequest,
  type BaseSandboxCommand,
  type CommandSandbox,
  type SolverSandboxCommand,
  type SandboxCommandResult,
  type SandboxIdentity,
  validateAgentSandboxLeaseRequest,
  validateSandboxCommand,
} from "./contracts.js";
import {
  buildAgentDockerCreateArguments,
  buildDockerCreateArguments,
  buildDockerExecArguments,
  buildSolverDockerExecArguments,
  parseSandboxImageInspection,
  sandboxDockerfileDigest,
  validateSandboxImageInspection,
} from "./docker.js";

interface ContainerState {
  Status?: unknown;
  ExitCode?: unknown;
  OOMKilled?: unknown;
  Error?: unknown;
}

export interface DockerSandboxTiming {
  cleanupTimeoutMs?: number;
  pollIntervalMs?: number;
  recoveryProbeTimeoutMs?: number;
}

const DEFAULT_DOCKER_SANDBOX_TIMING = {
  cleanupTimeoutMs: 5_000,
  pollIntervalMs: 100,
  recoveryProbeTimeoutMs: 1_000,
} as const;

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function dockerHostEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DOCKER_API_VERSION",
    "DOCKER_AUTH_CONFIG",
    "DOCKER_BUILDKIT",
    "DOCKER_CERT_PATH",
    "DOCKER_CLI_EXPERIMENTAL",
    "DOCKER_CONFIG",
    "DOCKER_CONTENT_TRUST",
    "DOCKER_CONTENT_TRUST_SERVER",
    "DOCKER_CONTEXT",
    "DOCKER_CUSTOM_HEADERS",
    "DOCKER_DEFAULT_PLATFORM",
    "DOCKER_HIDE_LEGACY_COMMANDS",
    "DOCKER_HOST",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "BUILDKIT_PROGRESS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "NO_COLOR",
    "SSH_AUTH_SOCK",
  ] as const) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function abortError(): Error {
  const error = new Error("Sandbox command was cancelled.");
  error.name = "AbortError";
  return error;
}

function processText(result: ProcessResult, stream: "stdout" | "stderr"): string {
  return result[stream].toString("utf8");
}

function dockerRuntimeInterrupted(result: ProcessResult): boolean {
  if (result.signal !== null) return true;
  if (result.exitCode !== 125) return false;
  const diagnostic = processText(result, "stderr").toLowerCase();
  return (
    diagnostic.includes("docker daemon") ||
    diagnostic.includes("error during connect") ||
    diagnostic.includes("connection refused") ||
    diagnostic.includes("unexpected eof")
  );
}

function requireSuccessfulDocker(operation: string, result: ProcessResult): ProcessResult {
  if (result.exitCode !== 0 || result.signal !== null) {
    const reason =
      result.signal === null
        ? `exited ${String(result.exitCode)}`
        : `was terminated by ${result.signal}`;
    throw new SandboxInfrastructureError(
      `Docker ${operation} ${reason}: ${processText(result, "stderr").trim() || "no error detail"}`,
    );
  }
  return result;
}

export class DockerCommandSandbox implements CommandSandbox {
  readonly identity: SandboxIdentity;
  readonly containerLabelValue = randomUUID();
  readonly #dockerCommand: string;
  readonly #timing: Required<DockerSandboxTiming>;

  constructor(
    identity: SandboxIdentity,
    dockerCommand = "docker",
    timing: DockerSandboxTiming = {},
  ) {
    this.identity = identity;
    this.#dockerCommand = dockerCommand;
    this.#timing = { ...DEFAULT_DOCKER_SANDBOX_TIMING, ...timing };
  }

  async #runDocker(
    args: readonly string[],
    options: {
      deadline?: number;
      signal?: AbortSignal;
      maxOutputBytes?: number;
    } = {},
  ): Promise<ProcessResult> {
    return runProcess(this.#dockerCommand, args, {
      cwd: process.cwd(),
      env: dockerHostEnvironment(),
      ...options,
    });
  }

  async #remove(containerName: string, settleLateCreation = false): Promise<void> {
    const deadline = performance.now() + this.#timing.cleanupTimeoutMs;
    while (true) {
      const remainingBeforeAttempt = deadline - performance.now();
      if (remainingBeforeAttempt <= (settleLateCreation ? 250 : 0)) return;
      const result = await this.#runDocker(["rm", "--force", containerName], { deadline });
      if (result.timedOut) {
        if (settleLateCreation && deadline - performance.now() <= 250) return;
        throw new SandboxInfrastructureError("Docker cleanup exceeded its 5 second deadline.");
      }
      const stderr = processText(result, "stderr");
      const missing = stderr.includes("No such container") || stderr.includes("No such object");
      if (result.exitCode !== 0 && !missing) {
        throw new SandboxInfrastructureError(
          `Docker cleanup failed: ${stderr.trim() || "no error detail"}`,
        );
      }
      if (!settleLateCreation) return;
      const remainingMs = Math.ceil(deadline - performance.now());
      if (remainingMs <= 100) return;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.min(this.#timing.pollIntervalMs, remainingMs)),
      );
    }
  }

  async #inspectState(
    containerName: string,
    options: { deadline: number; signal?: AbortSignal },
  ): Promise<ContainerState> {
    const result = await this.#runDocker(["inspect", containerName], options);
    if (result.cancelled) throw abortError();
    if (result.timedOut) {
      throw new SandboxInfrastructureError("Docker container inspection timed out.");
    }
    requireSuccessfulDocker("container inspection", result);
    let parsed: unknown;
    try {
      parsed = JSON.parse(processText(result, "stdout"));
    } catch (error) {
      throw new SandboxInfrastructureError(
        `Docker returned invalid container inspection JSON: ${errorDetail(error)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length !== 1) {
      throw new SandboxInfrastructureError(
        "Docker container inspection returned an unexpected result.",
      );
    }
    return (parsed[0] as { State?: ContainerState }).State ?? {};
  }

  #requireUser(): { uid: number; gid: number } {
    const getUid = process.getuid;
    const getGid = process.getgid;
    if (getUid === undefined || getGid === undefined) {
      throw new SandboxInfrastructureError("The Docker sandbox requires a POSIX host UID and GID.");
    }
    return { uid: getUid(), gid: getGid() };
  }

  async #publishSolverOutput(
    request: SolverSandboxCommand,
    containerName: string,
    deadline: number,
    user: { uid: number; gid: number },
  ): Promise<string | undefined> {
    let outputRoot: string;
    try {
      outputRoot = await realpath(request.outputRoot);
    } catch (error) {
      throw new SandboxInfrastructureError(
        `Solver output destination is inaccessible: ${errorDetail(error)}`,
      );
    }
    let stagingRoot: string;
    try {
      stagingRoot = await mkdtemp(join(outputRoot, ".palimpsest-output-"));
    } catch (error) {
      throw new SandboxInfrastructureError(
        `Unable to create solver output staging: ${errorDetail(error)}`,
      );
    }
    const stagedOutput = join(stagingRoot, "candidate");
    let outcome: string | undefined;
    let operationFailure: Error | undefined;
    try {
      outcome = await (async () => {
        const containerOutput = posix.join(SANDBOX_PATHS.output, request.outputPath);
        const extracted = await this.#runDocker(
          [
            "exec",
            "--workdir",
            SANDBOX_PATHS.submission,
            "--user",
            `${String(user.uid)}:${String(user.gid)}`,
            containerName,
            "/usr/bin/env",
            "-i",
            `PALIMPSEST_OUTPUT=${containerOutput}`,
            "/bin/sh",
            "-c",
            'if [ ! -e "$PALIMPSEST_OUTPUT" ]; then exit 40; fi; ' +
              'if [ -L "$PALIMPSEST_OUTPUT" ] || [ ! -f "$PALIMPSEST_OUTPUT" ]; then exit 41; fi; ' +
              'exec cat -- "$PALIMPSEST_OUTPUT"',
          ],
          {
            deadline,
            maxOutputBytes: SANDBOX_POLICY.solverOutputBytes + 1,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (extracted.cancelled) throw abortError();
        if (extracted.timedOut) {
          throw new SandboxInfrastructureError("Docker solver output extraction timed out.");
        }
        if (extracted.outputExceeded) {
          return `Solver output exceeds ${String(SANDBOX_POLICY.solverOutputBytes)} bytes.`;
        }
        if (extracted.exitCode !== 0 || extracted.signal !== null) {
          if (extracted.exitCode === 40) {
            return "Solver did not produce the declared output file.";
          }
          if (extracted.exitCode === 41) {
            return "Solver output must be a regular file.";
          }
          const diagnostic = processText(extracted, "stderr").trim();
          throw new SandboxInfrastructureError(
            `Docker solver output extraction failed: ${diagnostic || "no error detail"}`,
          );
        }

        if (extracted.stdout.byteLength > SANDBOX_POLICY.solverOutputBytes) {
          return `Solver output exceeds ${String(SANDBOX_POLICY.solverOutputBytes)} bytes.`;
        }
        if (extracted.stdout.byteLength === 0) {
          return "Solver output is empty.";
        }
        await writeFile(stagedOutput, extracted.stdout, { flag: "wx" });
        const durableOutput = join(outputRoot, request.outputPath);
        await mkdir(dirname(durableOutput), { recursive: true });
        await rename(stagedOutput, durableOutput);
        return undefined;
      })();
    } catch (error) {
      operationFailure =
        error instanceof SandboxInfrastructureError ||
        (error instanceof Error && error.name === "AbortError")
          ? error
          : new SandboxInfrastructureError(
              `Unable to publish solver output: ${errorDetail(error)}`,
            );
    }
    let cleanupFailure: SandboxInfrastructureError | undefined;
    try {
      await rm(stagingRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupFailure = new SandboxInfrastructureError(
        `Unable to clean solver output staging: ${errorDetail(error)}`,
      );
    }
    if (operationFailure !== undefined && cleanupFailure !== undefined) {
      throw new SandboxInfrastructureError("Solver output publication and cleanup both failed.", {
        cause: new AggregateError(
          [operationFailure, cleanupFailure],
          "Solver output publication and cleanup both failed.",
        ),
      });
    }
    if (operationFailure !== undefined) throw operationFailure;
    if (cleanupFailure !== undefined) throw cleanupFailure;
    return outcome;
  }

  async #waitForDocker(deadline: number, signal?: AbortSignal): Promise<void> {
    while (performance.now() < deadline) {
      if (signal?.aborted) throw abortError();
      const probeDeadline = Math.min(
        deadline,
        performance.now() + this.#timing.recoveryProbeTimeoutMs,
      );
      try {
        const result = await this.#runDocker(["info", "--format", "{{.ServerVersion}}"], {
          deadline: probeDeadline,
          ...(signal === undefined ? {} : { signal }),
        });
        if (result.cancelled) throw abortError();
        if (!result.timedOut && result.exitCode === 0 && result.signal === null) return;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (performance.now() >= deadline) {
          throw new SandboxInfrastructureError(
            `Docker did not recover before the command deadline: ${errorDetail(error)}`,
          );
        }
      }
      const remainingMs = Math.ceil(deadline - performance.now());
      if (remainingMs <= 0) break;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.min(this.#timing.pollIntervalMs, remainingMs)),
      );
    }
    throw new SandboxInfrastructureError("Docker did not recover before the command deadline.");
  }

  async #createAgentContainer(
    request: AgentSandboxLeaseRequest,
    containerName: string,
    user: { uid: number; gid: number },
    deadline: number,
  ): Promise<void> {
    const createArguments = await buildAgentDockerCreateArguments(
      request,
      this.identity,
      containerName,
      user,
      this.containerLabelValue,
    );
    let created: ProcessResult;
    try {
      created = await this.#runDocker(createArguments, {
        deadline,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      await this.#remove(containerName, true);
      throw new SandboxInfrastructureError(
        `Docker agent sandbox creation failed: ${errorDetail(error)}`,
      );
    }
    if (created.cancelled) {
      await this.#remove(containerName, true);
      throw abortError();
    }
    if (created.timedOut) {
      await this.#remove(containerName, true);
      throw new SandboxInfrastructureError("Docker agent sandbox creation timed out.");
    }
    if (created.exitCode !== 0 || created.signal !== null) {
      const detail = processText(created, "stderr").trim() || "no error detail";
      await this.#remove(containerName, true);
      throw new SandboxInfrastructureError(`Docker agent sandbox creation failed: ${detail}`);
    }

    const started = await this.#runDocker(["start", containerName], {
      deadline,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (started.cancelled) {
      await this.#remove(containerName);
      throw abortError();
    }
    if (
      started.timedOut ||
      started.exitCode !== 0 ||
      started.signal !== null ||
      deadline <= performance.now()
    ) {
      const detail = started.timedOut
        ? "start timed out"
        : processText(started, "stderr").trim() || "start failed";
      await this.#remove(containerName);
      throw new SandboxInfrastructureError(`Docker agent sandbox ${detail}.`);
    }
    let state: ContainerState;
    try {
      state = await this.#inspectState(containerName, {
        deadline,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      await this.#remove(containerName);
      throw error;
    }
    if (state.Status !== "running") {
      await this.#remove(containerName);
      throw new SandboxInfrastructureError(
        `Docker agent sandbox did not remain running: ${JSON.stringify(state)}`,
      );
    }
  }

  async openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease> {
    validateAgentSandboxLeaseRequest(request);
    if (request.signal?.aborted) throw abortError();
    const user = this.#requireUser();
    const initialDeadline = performance.now() + request.timeoutMs;
    let containerName = `palimpsest-agent-${randomUUID()}`;
    let generation = 1;
    let containerPresent = false;
    let available = false;
    let closed = false;

    await this.#createAgentContainer(request, containerName, user, initialDeadline);
    containerPresent = true;
    available = true;

    const discard = async (): Promise<void> => {
      if (!containerPresent) {
        available = false;
        return;
      }
      await this.#remove(containerName);
      containerPresent = false;
      available = false;
    };
    const createReplacement = async (deadline: number, signal?: AbortSignal): Promise<void> => {
      await this.#waitForDocker(deadline, signal);
      if (containerPresent) await discard();
      generation += 1;
      containerName = `palimpsest-agent-${randomUUID()}`;
      const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
      await this.#createAgentContainer(
        {
          ...request,
          timeoutMs: remainingMs,
          ...(signal === undefined ? {} : { signal }),
        },
        containerName,
        user,
        deadline,
      );
      containerPresent = true;
      available = true;
    };
    const indeterminateResult = (
      result: ProcessResult | undefined,
      detail: string,
    ): SandboxCommandResult => ({
      exitCode: null,
      stdout: result === undefined ? "" : processText(result, "stdout"),
      stderr:
        `${result === undefined ? "" : processText(result, "stderr")}\n${detail}\nThe interrupted command was not replayed; inspect the persistent workspace before continuing.`.trim(),
      timedOut: false,
      outputExceeded: false,
      indeterminate: true,
      sandboxGeneration: generation,
    });

    return {
      identity: this.identity,
      execute: async (command: BaseSandboxCommand): Promise<SandboxCommandResult> => {
        validateSandboxCommand(command);
        if (closed) throw new SandboxInfrastructureError("Agent sandbox lease is closed.");
        if (command.signal?.aborted) throw abortError();
        const deadline = performance.now() + command.timeoutMs;
        if (!available) {
          await createReplacement(deadline, command.signal);
        }

        let executed: ProcessResult;
        try {
          executed = await this.#runDocker(buildDockerExecArguments(command, containerName, user), {
            deadline,
            maxOutputBytes: SANDBOX_POLICY.maxOutputBytes,
            ...(command.signal === undefined ? {} : { signal: command.signal }),
          });
        } catch (error) {
          await createReplacement(deadline, command.signal);
          return indeterminateResult(
            undefined,
            `Sandbox runtime interrupted command execution: ${errorDetail(error)}`,
          );
        }

        if (executed.cancelled) {
          await discard();
          throw abortError();
        }
        const overflowMessage = executed.outputExceeded
          ? "\nCommand output exceeded the 4 MiB host safety limit."
          : "";
        if (executed.timedOut || executed.outputExceeded) {
          await discard();
          return {
            exitCode: executed.exitCode,
            stdout: processText(executed, "stdout"),
            stderr: `${processText(executed, "stderr")}${overflowMessage}`,
            timedOut: executed.timedOut,
            outputExceeded: executed.outputExceeded,
            sandboxGeneration: generation,
          };
        }

        if (dockerRuntimeInterrupted(executed)) {
          await createReplacement(deadline, command.signal);
          return indeterminateResult(executed, "Sandbox runtime interrupted command execution.");
        }

        if (executed.exitCode !== 0) {
          let state: ContainerState;
          try {
            state = await this.#inspectState(containerName, {
              deadline,
              ...(command.signal === undefined ? {} : { signal: command.signal }),
            });
          } catch (error) {
            await createReplacement(deadline, command.signal);
            return indeterminateResult(
              executed,
              `Sandbox runtime interrupted command inspection: ${errorDetail(error)}`,
            );
          }
          if (state.Status !== "running") {
            if (state.OOMKilled === true) {
              await discard();
              return {
                exitCode: executed.exitCode,
                stdout: processText(executed, "stdout"),
                stderr: `${processText(executed, "stderr")}\nCommand was terminated by the sandbox memory limit.`,
                timedOut: false,
                outputExceeded: false,
                sandboxGeneration: generation,
              };
            }
            await createReplacement(deadline, command.signal);
            return indeterminateResult(
              executed,
              `Sandbox stopped during command execution: ${JSON.stringify(state)}`,
            );
          }
        }

        return {
          exitCode: executed.exitCode,
          stdout: processText(executed, "stdout"),
          stderr: processText(executed, "stderr"),
          timedOut: false,
          outputExceeded: false,
          sandboxGeneration: generation,
        };
      },
      close: async (): Promise<void> => {
        if (closed) return;
        await discard();
        closed = true;
      },
    };
  }

  async execute(request: SolverSandboxCommand): Promise<SandboxCommandResult> {
    validateSandboxCommand(request);
    if (request.signal?.aborted) throw abortError();
    const deadline = performance.now() + request.timeoutMs;
    const user = this.#requireUser();
    const containerName = `palimpsest-${request.profile}-${randomUUID()}`;
    const createArguments = await buildDockerCreateArguments(
      request,
      this.identity,
      containerName,
      user,
      this.containerLabelValue,
    );
    let removal: Promise<void> | undefined;
    const cleanup = async (): Promise<void> => {
      try {
        removal ??= this.#remove(containerName);
        await removal;
      } catch (error) {
        throw error instanceof SandboxInfrastructureError
          ? error
          : new SandboxInfrastructureError(`Docker cleanup failed: ${errorDetail(error)}`);
      }
    };
    const cleanupPartialCreation = async (): Promise<void> => {
      try {
        await this.#remove(containerName, true);
      } catch (error) {
        throw error instanceof SandboxInfrastructureError
          ? error
          : new SandboxInfrastructureError(`Docker cleanup failed: ${errorDetail(error)}`);
      }
    };

    if (deadline <= performance.now()) {
      await cleanup();
      return {
        exitCode: null,
        stdout: "",
        stderr: "Sandbox command timed out before Docker container creation.",
        timedOut: true,
        outputExceeded: false,
      };
    }

    let created: ProcessResult;
    try {
      created = await this.#runDocker(createArguments, {
        deadline,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      await cleanupPartialCreation();
      throw new SandboxInfrastructureError(
        `Docker container creation failed: ${errorDetail(error)}`,
      );
    }
    if (created.cancelled) {
      await cleanupPartialCreation();
      throw abortError();
    }
    if (created.timedOut) {
      await cleanupPartialCreation();
      return {
        exitCode: null,
        stdout: processText(created, "stdout"),
        stderr:
          `${processText(created, "stderr")}\nSandbox command timed out during Docker container creation.`.trim(),
        timedOut: true,
        outputExceeded: false,
      };
    }
    if (created.exitCode !== 0 || created.signal !== null) {
      const creationError = new SandboxInfrastructureError(
        `Docker container creation failed: ${processText(created, "stderr").trim() || "no error detail"}`,
      );
      await cleanupPartialCreation();
      throw creationError;
    }
    if (request.signal?.aborted) {
      await cleanup();
      throw abortError();
    }

    let primaryError: unknown;
    let commandResult: SandboxCommandResult | undefined;
    try {
      if (deadline <= performance.now()) {
        commandResult = {
          exitCode: null,
          stdout: "",
          stderr: "Sandbox command timed out before Docker container start.",
          timedOut: true,
          outputExceeded: false,
        };
      } else {
        const started = await this.#runDocker(["start", containerName], {
          deadline,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (started.cancelled) throw abortError();
        if (started.timedOut) {
          commandResult = {
            exitCode: null,
            stdout: processText(started, "stdout"),
            stderr:
              `${processText(started, "stderr")}\nSandbox command timed out during Docker container start.`.trim(),
            timedOut: true,
            outputExceeded: false,
          };
        } else {
          requireSuccessfulDocker("container start", started);
          const executed = await this.#runDocker(
            buildSolverDockerExecArguments(request, containerName, user),
            {
              deadline,
              maxOutputBytes: SANDBOX_POLICY.maxOutputBytes,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            },
          );
          if (executed.cancelled) throw abortError();
          if (dockerRuntimeInterrupted(executed)) {
            throw new SandboxInfrastructureError(
              `Docker interrupted solver execution: ${processText(executed, "stderr").trim() || "no error detail"}`,
            );
          }
          let resourceMessage = "";
          let state: ContainerState | undefined;
          if (!executed.timedOut && !executed.outputExceeded) {
            state = await this.#inspectState(containerName, {
              deadline,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
            if (state.OOMKilled === true) {
              resourceMessage = "\nCommand was terminated by the sandbox memory limit.";
            } else if (typeof state.Error === "string" && state.Error.length > 0) {
              resourceMessage = `\nSandbox runtime reported: ${state.Error}`;
            } else if (state.Status !== "running") {
              resourceMessage = `\nSandbox stopped during solver execution: ${JSON.stringify(state)}`;
            }
          }
          const overflowMessage = executed.outputExceeded
            ? "\nCommand output exceeded the 4 MiB host safety limit."
            : "";
          commandResult = {
            exitCode: executed.exitCode,
            stdout: processText(executed, "stdout"),
            stderr: `${processText(executed, "stderr")}${overflowMessage}${resourceMessage}`,
            timedOut: executed.timedOut,
            outputExceeded: executed.outputExceeded,
          };
          if (
            commandResult.exitCode === 0 &&
            !commandResult.timedOut &&
            !commandResult.outputExceeded &&
            state?.Status === "running"
          ) {
            const outputFailure = await this.#publishSolverOutput(
              request,
              containerName,
              deadline,
              user,
            );
            if (outputFailure !== undefined) {
              commandResult = { ...commandResult, outputFailure };
            }
          }
        }
      }
    } catch (error) {
      primaryError = error;
    }

    await cleanup();
    if (primaryError !== undefined) throw primaryError;
    if (commandResult === undefined) {
      throw new SandboxInfrastructureError("Docker command ended without a result.");
    }
    return commandResult;
  }
}

export async function createDockerCommandSandbox(
  options: {
    root?: string;
    expectedImageId?: string;
  } = {},
): Promise<DockerCommandSandbox> {
  const root = options.root ?? process.cwd();
  const sourceDigest = await sandboxDockerfileDigest(root);
  const imageReference = options.expectedImageId ?? SANDBOX_IMAGE_TAG;
  let inspected: ProcessResult;
  try {
    inspected = await runProcess("docker", ["image", "inspect", imageReference], {
      cwd: root,
      env: dockerHostEnvironment(),
    });
  } catch (error) {
    throw new SandboxInfrastructureError(
      `Docker cannot inspect the puzzle sandbox; run \`pnpm puzzle:sandbox:build\`: ${errorDetail(error)}`,
    );
  }
  if (inspected.exitCode !== 0 || inspected.signal !== null) {
    throw new SandboxInfrastructureError(
      `The puzzle sandbox image is unavailable; run \`pnpm puzzle:sandbox:build\`: ${processText(inspected, "stderr").trim()}`,
    );
  }
  const identity = validateSandboxImageInspection(
    parseSandboxImageInspection(processText(inspected, "stdout")),
    sourceDigest,
    options.expectedImageId,
  );
  return new DockerCommandSandbox(identity);
}
