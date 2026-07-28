import { randomUUID } from "node:crypto";

import { runProcess, type ProcessResult } from "../process.js";
import {
  SANDBOX_IMAGE_TAG,
  SANDBOX_POLICY,
  SandboxInfrastructureError,
  type CommandSandbox,
  type SandboxCommand,
  type SandboxCommandResult,
  type SandboxIdentity,
  validateSandboxCommand,
} from "./contracts.js";
import {
  buildDockerCreateArguments,
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

  constructor(identity: SandboxIdentity, dockerCommand = "docker") {
    this.identity = identity;
    this.#dockerCommand = dockerCommand;
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
    const deadline = performance.now() + 5_000;
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
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(100, remainingMs)));
    }
  }

  async #inspectState(containerName: string): Promise<ContainerState> {
    const result = requireSuccessfulDocker(
      "container inspection",
      await this.#runDocker(["inspect", containerName]),
    );
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

  async execute(request: SandboxCommand): Promise<SandboxCommandResult> {
    validateSandboxCommand(request);
    if (request.signal?.aborted) throw abortError();
    const deadline = performance.now() + request.timeoutMs;
    const getUid = process.getuid;
    const getGid = process.getgid;
    if (getUid === undefined || getGid === undefined) {
      throw new SandboxInfrastructureError("The Docker sandbox requires a POSIX host UID and GID.");
    }
    const containerName = `palimpsest-${request.profile}-${randomUUID()}`;
    const createArguments = await buildDockerCreateArguments(
      request,
      this.identity,
      containerName,
      { uid: getUid(), gid: getGid() },
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
        const started = await this.#runDocker(["start", "--attach", containerName], {
          deadline,
          maxOutputBytes: SANDBOX_POLICY.maxOutputBytes,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (started.cancelled) {
          throw abortError();
        }
        let exitCode: number | null = started.exitCode;
        let resourceMessage = "";
        if (!started.timedOut && !started.outputExceeded) {
          const state = await this.#inspectState(containerName);
          if (state.Status !== "exited" || typeof state.ExitCode !== "number") {
            throw new SandboxInfrastructureError(
              `Docker did not report an exited command state: ${JSON.stringify(state)}`,
            );
          }
          exitCode = state.ExitCode;
          if (state.OOMKilled === true) {
            resourceMessage = "\nCommand was terminated by the sandbox memory limit.";
          } else if (typeof state.Error === "string" && state.Error.length > 0) {
            resourceMessage = `\nSandbox runtime reported: ${state.Error}`;
          }
        }
        const overflowMessage = started.outputExceeded
          ? "\nCommand output exceeded the 4 MiB host safety limit."
          : "";
        commandResult = {
          exitCode,
          stdout: processText(started, "stdout"),
          stderr: `${processText(started, "stderr")}${overflowMessage}${resourceMessage}`,
          timedOut: started.timedOut,
          outputExceeded: started.outputExceeded,
        };
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
