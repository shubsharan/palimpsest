export const SANDBOX_IMAGE_REPOSITORY = "palimpsest-puzzle-sandbox";
export const SANDBOX_DOCKERFILE_PATH = "containers/puzzle-sandbox/Dockerfile";
export const SANDBOX_PROFILE_LABEL = "org.palimpsest.puzzle-sandbox.profile-version";
export const SANDBOX_SOURCE_LABEL = "org.palimpsest.puzzle-sandbox.source-digest";
export const SANDBOX_CONTAINER_LABEL = "org.palimpsest.puzzle-sandbox.command";
export const SANDBOX_RESOURCE_LABEL = "org.palimpsest.puzzle-sandbox.resource";

export type SandboxContainerLabels = Readonly<Record<string, string>>;

export function sandboxImageTag(sourceDigest: string): string {
  if (!/^[0-9a-f]{64}$/.test(sourceDigest)) {
    throw new Error("Sandbox source digest must be 64 lowercase hexadecimal characters.");
  }
  return `${SANDBOX_IMAGE_REPOSITORY}:sha256-${sourceDigest}`;
}

export const SANDBOX_PATHS = {
  workspace: "/workspace",
  submission: "/submission",
  output: "/output",
  evidence: "/evidence",
  gitOrigin: "/git/origin.git",
  ciphertext: "/input/ciphertext.txt",
} as const;

export const SANDBOX_POLICY = {
  network: "none",
  cpus: 2,
  memoryBytes: 2_147_483_648,
  pids: 256,
  tmpfsBytes: 268_435_456,
  solverOutputBytes: 16_777_216,
  maxOutputBytes: 4_194_304,
} as const;

export interface BaseSandboxCommand {
  command: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentSandboxLeaseRequest {
  profile: "agent";
  workspacePath: string;
  evidencePath: string;
  gitOriginPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentSandboxCommand extends BaseSandboxCommand {
  profile: "agent";
  workspacePath: string;
  evidencePath: string;
  gitOriginPath: string;
}

export interface SolverSandboxCommand extends BaseSandboxCommand {
  profile: "solver";
  submissionPath: string;
  ciphertextPath: string;
  outputRoot: string;
  outputPath: string;
}

export type SandboxCommand = AgentSandboxCommand | SolverSandboxCommand;

export interface SandboxCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  outputFailure?: string;
}

export interface SandboxIdentity {
  imageTag: string;
  imageId: string;
  sourceDigest: string;
  profileVersion: 1;
}

export interface CommandSandbox {
  readonly identity: SandboxIdentity;
  openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease>;
  execute(request: SolverSandboxCommand): Promise<SandboxCommandResult>;
}

export interface AgentSandboxLease {
  readonly identity: SandboxIdentity;
  execute(request: BaseSandboxCommand): Promise<SandboxCommandResult>;
  close(): Promise<void>;
}

export class InfrastructureError extends Error {
  override readonly name: string = "InfrastructureError";
  readonly component: string = "trusted-host";
}

export class SandboxInfrastructureError extends InfrastructureError {
  override readonly name = "SandboxInfrastructureError";
  override readonly component = "command-sandbox";
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

export function validateSandboxCommand(request: BaseSandboxCommand): void {
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

export function validateAgentSandboxLeaseRequest(request: AgentSandboxLeaseRequest): void {
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new Error("Sandbox lease timeout must be a positive safe integer.");
  }
}
