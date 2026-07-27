import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

export const SANDBOX_IMAGE_TAG = "palimpsest-puzzle-sandbox:0.1.0";
export const SANDBOX_DOCKERFILE_PATH = "containers/puzzle-sandbox/Dockerfile";
export const SANDBOX_PROFILE_LABEL = "org.palimpsest.puzzle-sandbox.profile-version";
export const SANDBOX_SOURCE_LABEL = "org.palimpsest.puzzle-sandbox.source-digest";
export const SANDBOX_CONTAINER_LABEL = "org.palimpsest.puzzle-sandbox.command";

export const SANDBOX_PATHS = {
  workspace: "/workspace",
  evidence: "/evidence",
  reference: "/reference",
  sharedGit: "/git/shared.git",
  ciphertext: "/input/ciphertext.txt",
} as const;

export const SANDBOX_POLICY = {
  network: "none",
  cpus: 2,
  memoryBytes: 2_147_483_648,
  pids: 256,
  tmpfsBytes: 268_435_456,
  maxOutputBytes: 4_194_304,
} as const;

interface BaseSandboxCommand {
  command: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentSandboxCommand extends BaseSandboxCommand {
  profile: "agent";
  workspacePath: string;
  evidencePath: string;
  referenceCorpusPath: string;
  sharedGitPath: string;
}

export interface EvaluationSandboxCommand extends BaseSandboxCommand {
  profile: "evaluation";
  workspacePath: string;
  ciphertextPath: string;
  frozenGitPath: string;
  outputPath: string;
}

export type SandboxCommand = AgentSandboxCommand | EvaluationSandboxCommand;

export interface SandboxCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
}

export interface SandboxIdentity {
  imageTag: string;
  imageId: string;
  sourceDigest: string;
  profileVersion: 1;
}

export interface CommandSandbox {
  readonly identity: SandboxIdentity;
  execute(request: SandboxCommand): Promise<SandboxCommandResult>;
}

export class SandboxInfrastructureError extends Error {
  override readonly name = "SandboxInfrastructureError";
}

export type WorkspaceFileFailure = "absolute" | "outside" | "missing" | "not-regular";

export class WorkspaceFileError extends Error {
  override readonly name = "WorkspaceFileError";
  readonly failure: WorkspaceFileFailure;

  constructor(failure: WorkspaceFileFailure, message: string) {
    super(message);
    this.failure = failure;
  }
}

interface CapturedProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

interface CapturedProcessOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface DockerImageInspection {
  Id?: unknown;
  Config?: {
    Labels?: Record<string, string> | null;
  };
}

interface ContainerState {
  Status?: unknown;
  ExitCode?: unknown;
  OOMKilled?: unknown;
  Error?: unknown;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function killProcessGroup(child: ChildProcess): void {
  if (child.pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process may already have exited while termination was requested.
    }
  }
  child.kill("SIGKILL");
}

function runCaptured(
  command: string,
  args: readonly string[],
  options: CapturedProcessOptions = {},
): Promise<CapturedProcessResult> {
  if (options.signal?.aborted) throw abortError();
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let cancelled = false;
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      killProcessGroup(child);
    };
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            stop();
          }, options.timeoutMs);
    const abort = () => {
      cancelled = true;
      stop();
    };
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      finish();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      finish();
      resolveResult({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        cancelled,
      });
    });
  });
}

function requireSuccessfulDocker(
  operation: string,
  result: CapturedProcessResult,
): CapturedProcessResult {
  if (result.exitCode !== 0 || result.signal !== null) {
    const reason =
      result.signal === null
        ? `exited ${String(result.exitCode)}`
        : `was terminated by ${result.signal}`;
    throw new SandboxInfrastructureError(
      `Docker ${operation} ${reason}: ${result.stderr.trim() || "no error detail"}`,
    );
  }
  return result;
}

export async function sandboxDockerfileDigest(root = process.cwd()): Promise<string> {
  return createHash("sha256")
    .update(await readFile(join(resolve(root), SANDBOX_DOCKERFILE_PATH)))
    .digest("hex");
}

function parseInspection(source: string): DockerImageInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new SandboxInfrastructureError(
      `Docker returned invalid image inspection JSON: ${errorDetail(error)}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new SandboxInfrastructureError("Docker image inspection returned an unexpected result.");
  }
  return parsed[0] as DockerImageInspection;
}

export function validateSandboxImageInspection(
  inspection: DockerImageInspection,
  expectedSourceDigest: string,
  expectedImageId?: string,
): SandboxIdentity {
  const labels = inspection.Config?.Labels;
  const imageId = inspection.Id;
  if (
    typeof imageId !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(imageId) ||
    labels?.[SANDBOX_PROFILE_LABEL] !== "1" ||
    labels[SANDBOX_SOURCE_LABEL] !== expectedSourceDigest
  ) {
    throw new SandboxInfrastructureError(
      "The puzzle sandbox image is missing or stale; run `pnpm puzzle:sandbox:build`.",
    );
  }
  if (expectedImageId !== undefined && imageId !== expectedImageId) {
    throw new SandboxInfrastructureError(
      `The puzzle sandbox image does not match the attempt-recorded image ID ${expectedImageId}.`,
    );
  }
  return {
    imageTag: SANDBOX_IMAGE_TAG,
    imageId,
    sourceDigest: expectedSourceDigest,
    profileVersion: 1,
  };
}

function validateCommand(request: SandboxCommand): void {
  if (
    request.command.length === 0 ||
    request.command.length > 32_768 ||
    request.command.includes("\0")
  ) {
    throw new Error("Command must contain between 1 and 32768 non-NUL characters.");
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new Error("Command timeout must be a positive safe integer.");
  }
}

function isOutside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference);
}

function validateRelativeWorkspacePath(path: string, label: string): void {
  if (path.length === 0 || isAbsolute(path)) {
    throw new WorkspaceFileError(
      "absolute",
      `${label} must be a non-empty path relative to the workspace.`,
    );
  }
  const normalized = posix.normalize(path);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new WorkspaceFileError("outside", `${label} must remain inside the workspace.`);
  }
}

export async function resolveWorkspacePath(
  workspacePath: string,
  path: string,
  label: string,
): Promise<string> {
  validateRelativeWorkspacePath(path, label);
  const workspace = await realpath(workspacePath);
  const candidate = resolve(workspace, path);
  if (isOutside(workspace, candidate)) {
    throw new WorkspaceFileError("outside", `${label} must remain inside the workspace.`);
  }
  return candidate;
}

export async function resolveWorkspaceRegularFile(
  workspacePath: string,
  path: string,
  label: string,
): Promise<string> {
  const workspace = await realpath(workspacePath);
  const candidate = await resolveWorkspacePath(workspace, path, label);
  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidate);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new WorkspaceFileError("missing", `${label} does not exist.`);
    }
    throw error;
  }
  if (isOutside(workspace, resolvedCandidate)) {
    throw new WorkspaceFileError("outside", `${label} resolves outside the declared workspace.`);
  }
  if (!(await stat(resolvedCandidate)).isFile()) {
    throw new WorkspaceFileError("not-regular", `${label} must resolve to a regular file.`);
  }
  return resolvedCandidate;
}

async function requireMountSource(
  path: string,
  expected: "file" | "directory" | "either",
  role: string,
): Promise<string> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path);
  } catch (error) {
    throw new SandboxInfrastructureError(
      `Sandbox ${role} mount is inaccessible: ${errorDetail(error)}`,
    );
  }
  const metadata = await stat(resolvedPath);
  if (
    (expected === "file" && !metadata.isFile()) ||
    (expected === "directory" && !metadata.isDirectory()) ||
    (expected === "either" && !metadata.isFile() && !metadata.isDirectory())
  ) {
    throw new SandboxInfrastructureError(
      `Sandbox ${role} mount must be ${expected === "either" ? "a file or directory" : `a ${expected}`}.`,
    );
  }
  if (resolvedPath.includes(",")) {
    throw new SandboxInfrastructureError(
      `Sandbox ${role} mount contains a comma unsupported by Docker --mount.`,
    );
  }
  return resolvedPath;
}

function mountArgument(source: string, target: string, readOnly: boolean): string {
  return `type=bind,source=${source},target=${target}${readOnly ? ",readonly" : ""}`;
}

export async function buildDockerCreateArguments(
  request: SandboxCommand,
  identity: SandboxIdentity,
  containerName: string,
  user: { uid: number; gid: number },
  containerLabelValue = "1",
): Promise<string[]> {
  validateCommand(request);
  const workspace = await requireMountSource(request.workspacePath, "directory", "workspace");
  const mounts: Array<{ source: string; target: string; readOnly: boolean }> = [
    { source: workspace, target: SANDBOX_PATHS.workspace, readOnly: false },
  ];
  const environment = [
    "HOME=/workspace",
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8",
    "TMPDIR=/tmp",
    "GIT_TERMINAL_PROMPT=0",
  ];

  if (request.profile === "agent") {
    mounts.push(
      {
        source: await requireMountSource(request.evidencePath, "directory", "evidence"),
        target: SANDBOX_PATHS.evidence,
        readOnly: true,
      },
      {
        source: await requireMountSource(
          request.referenceCorpusPath,
          "directory",
          "reference corpus",
        ),
        target: SANDBOX_PATHS.reference,
        readOnly: true,
      },
      {
        source: await requireMountSource(request.sharedGitPath, "directory", "shared Git"),
        target: SANDBOX_PATHS.sharedGit,
        readOnly: false,
      },
    );
  } else {
    validateRelativeWorkspacePath(request.outputPath, "Reviewer outputPath");
    mounts.push(
      {
        source: await requireMountSource(request.ciphertextPath, "file", "ciphertext"),
        target: SANDBOX_PATHS.ciphertext,
        readOnly: true,
      },
      {
        source: await requireMountSource(request.frozenGitPath, "directory", "frozen Git"),
        target: SANDBOX_PATHS.sharedGit,
        readOnly: true,
      },
    );
    environment.push(
      `PALIMPSEST_CIPHERTEXT=${SANDBOX_PATHS.ciphertext}`,
      `PALIMPSEST_OUTPUT=${posix.join(SANDBOX_PATHS.workspace, request.outputPath)}`,
    );
  }

  const args = [
    "create",
    "--name",
    containerName,
    "--label",
    `${SANDBOX_CONTAINER_LABEL}=${containerLabelValue}`,
    "--network",
    SANDBOX_POLICY.network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(SANDBOX_POLICY.pids),
    "--memory",
    String(SANDBOX_POLICY.memoryBytes),
    "--cpus",
    String(SANDBOX_POLICY.cpus),
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,size=${String(SANDBOX_POLICY.tmpfsBytes)}`,
    "--user",
    `${String(user.uid)}:${String(user.gid)}`,
  ];
  for (const mount of mounts) {
    args.push("--mount", mountArgument(mount.source, mount.target, mount.readOnly));
  }
  args.push(
    "--workdir",
    SANDBOX_PATHS.workspace,
    identity.imageId,
    "/usr/bin/env",
    "-i",
    ...environment,
    "/bin/sh",
    "-lc",
    request.command,
  );
  return args;
}

function abortError(): Error {
  const error = new Error("Sandbox command was cancelled.");
  error.name = "AbortError";
  return error;
}

export class DockerCommandSandbox implements CommandSandbox {
  readonly identity: SandboxIdentity;
  readonly containerLabelValue = randomUUID();
  readonly #dockerCommand: string;

  constructor(identity: SandboxIdentity, dockerCommand = "docker") {
    this.identity = identity;
    this.#dockerCommand = dockerCommand;
  }

  async #remove(containerName: string, settleLateCreation = false): Promise<void> {
    const deadline = performance.now() + 5_000;
    while (true) {
      const remainingMs = Math.ceil(deadline - performance.now());
      if (remainingMs <= 0) return;
      const result = await runCaptured(this.#dockerCommand, ["rm", "--force", containerName], {
        timeoutMs: remainingMs,
      });
      if (result.timedOut) {
        throw new SandboxInfrastructureError("Docker cleanup exceeded its 5 second deadline.");
      }
      const missing =
        result.stderr.includes("No such container") || result.stderr.includes("No such object");
      if (result.exitCode !== 0 && !missing) {
        throw new SandboxInfrastructureError(
          `Docker cleanup failed: ${result.stderr.trim() || "no error detail"}`,
        );
      }
      if (!settleLateCreation) return;
      // Killing `docker create` can race a daemon-side late materialization. Keep
      // removing by the predeclared name for the bounded cleanup window.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(100, remainingMs)));
    }
  }

  async #inspectState(containerName: string): Promise<ContainerState> {
    const result = requireSuccessfulDocker(
      "container inspection",
      await runCaptured(this.#dockerCommand, ["inspect", containerName]),
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
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
    validateCommand(request);
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
      {
        uid: getUid(),
        gid: getGid(),
      },
      this.containerLabelValue,
    );
    let removal: Promise<void> | undefined;
    const ensureRemoval = (): Promise<void> => {
      removal ??= this.#remove(containerName);
      return removal;
    };
    const cleanup = async (): Promise<void> => {
      try {
        await ensureRemoval();
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
    const remainingCreateMs = Math.ceil(deadline - performance.now());
    if (remainingCreateMs <= 0) {
      await cleanup();
      return {
        exitCode: null,
        stdout: "",
        stderr: "Sandbox command timed out before Docker container creation.",
        timedOut: true,
        outputExceeded: false,
      };
    }
    let created: CapturedProcessResult;
    try {
      created = await runCaptured(this.#dockerCommand, createArguments, {
        timeoutMs: remainingCreateMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      await cleanupPartialCreation();
      if (error instanceof Error && error.name === "AbortError") throw error;
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
        stdout: created.stdout,
        stderr:
          `${created.stderr}\nSandbox command timed out during Docker container creation.`.trim(),
        timedOut: true,
        outputExceeded: false,
      };
    }
    if (created.exitCode !== 0 || created.signal !== null) {
      const creationError = new SandboxInfrastructureError(
        `Docker container creation failed: ${created.stderr.trim() || "no error detail"}`,
      );
      await cleanupPartialCreation();
      throw creationError;
    }
    let primaryError: unknown;
    let commandResult: SandboxCommandResult | undefined;

    if (request.signal?.aborted) {
      await cleanup();
      throw abortError();
    }

    try {
      commandResult = await new Promise<SandboxCommandResult>((resolveResult, reject) => {
        const remainingStartMs = Math.ceil(deadline - performance.now());
        if (remainingStartMs <= 0) {
          resolveResult({
            exitCode: null,
            stdout: "",
            stderr: "Sandbox command timed out before Docker container start.",
            timedOut: true,
            outputExceeded: false,
          });
          return;
        }
        const child = spawn(this.#dockerCommand, ["start", "--attach", containerName], {
          detached: process.platform !== "win32",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let capturedBytes = 0;
        let timedOut = false;
        let outputExceeded = false;
        let cancelled = false;
        let stopping = false;

        const stop = () => {
          if (stopping) return;
          stopping = true;
          killProcessGroup(child);
          void ensureRemoval().catch(() => undefined);
        };
        const collect = (target: Buffer[], chunk: Buffer) => {
          const remaining = SANDBOX_POLICY.maxOutputBytes - capturedBytes;
          if (remaining > 0) {
            const retained = chunk.subarray(0, remaining);
            target.push(retained);
            capturedBytes += retained.byteLength;
          }
          if (chunk.byteLength > remaining) {
            outputExceeded = true;
            stop();
          }
        };
        child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
        child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));

        const timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, remainingStartMs);
        const abort = () => {
          cancelled = true;
          stop();
        };
        request.signal?.addEventListener("abort", abort, { once: true });
        if (request.signal?.aborted) abort();

        child.once("error", (error) => {
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", abort);
          reject(new SandboxInfrastructureError(`Docker container start failed: ${error.message}`));
        });
        child.once("close", async (startExitCode, startSignal) => {
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", abort);
          if (cancelled) {
            reject(abortError());
            return;
          }
          let exitCode: number | null = null;
          let resourceMessage = "";
          if (!timedOut && !outputExceeded) {
            try {
              const state = await this.#inspectState(containerName);
              if (state.Status !== "exited" || typeof state.ExitCode !== "number") {
                reject(
                  new SandboxInfrastructureError(
                    `Docker did not report an exited command state: ${JSON.stringify(state)}`,
                  ),
                );
                return;
              }
              exitCode = state.ExitCode;
              if (state.OOMKilled === true) {
                resourceMessage = "\nCommand was terminated by the sandbox memory limit.";
              } else if (typeof state.Error === "string" && state.Error.length > 0) {
                resourceMessage = `\nSandbox runtime reported: ${state.Error}`;
              }
            } catch (error) {
              reject(error);
              return;
            }
          } else if (startSignal === null && startExitCode !== null) {
            exitCode = startExitCode;
          }
          const overflowMessage = outputExceeded
            ? "\nCommand output exceeded the 4 MiB host safety limit."
            : "";
          resolveResult({
            exitCode,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: `${Buffer.concat(stderr).toString("utf8")}${overflowMessage}${resourceMessage}`,
            timedOut,
            outputExceeded,
          });
        });
      });
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
  const sourceDigest = await sandboxDockerfileDigest(options.root);
  const imageReference = options.expectedImageId ?? SANDBOX_IMAGE_TAG;
  let inspected: CapturedProcessResult;
  try {
    inspected = await runCaptured("docker", ["image", "inspect", imageReference]);
  } catch (error) {
    throw new SandboxInfrastructureError(
      `Docker cannot inspect the puzzle sandbox; run \`pnpm puzzle:sandbox:build\`: ${errorDetail(error)}`,
    );
  }
  if (inspected.exitCode !== 0 || inspected.signal !== null) {
    throw new SandboxInfrastructureError(
      `The puzzle sandbox image is unavailable; run \`pnpm puzzle:sandbox:build\`: ${inspected.stderr.trim()}`,
    );
  }
  const identity = validateSandboxImageInspection(
    parseInspection(inspected.stdout),
    sourceDigest,
    options.expectedImageId,
  );
  return new DockerCommandSandbox(identity);
}
