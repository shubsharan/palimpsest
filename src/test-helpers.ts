import {
  type AgentSandboxLease,
  type AgentSandboxLeaseRequest,
  type CommandSandbox,
  type EvaluationSandboxCommand,
  type SandboxCommand,
  type SandboxCommandResult,
  type SandboxIdentity,
} from "./sandbox/contracts.js";

export const TEST_SANDBOX_IDENTITY: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"1".repeat(64)}`,
  sourceDigest: "2".repeat(64),
  profileVersion: 1,
};

const SUCCESS: SandboxCommandResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  outputExceeded: false,
};

export class FakeCommandSandbox implements CommandSandbox {
  readonly identity = TEST_SANDBOX_IDENTITY;
  readonly requests: SandboxCommand[] = [];
  readonly leases: AgentSandboxLeaseRequest[] = [];
  closedLeases = 0;
  readonly #execute: (request: SandboxCommand) => Promise<SandboxCommandResult>;

  constructor(
    execute: (request: SandboxCommand) => Promise<SandboxCommandResult> = async () => SUCCESS,
  ) {
    this.#execute = execute;
  }

  async openAgentLease(request: AgentSandboxLeaseRequest): Promise<AgentSandboxLease> {
    this.leases.push(request);
    const mounts = {
      profile: request.profile,
      workspacePath: request.workspacePath,
      evidencePath: request.evidencePath,
      referenceCorpusPath: request.referenceCorpusPath,
      sharedGitPath: request.sharedGitPath,
    } as const;
    return {
      identity: this.identity,
      execute: async (command) => {
        const fullRequest = { ...mounts, ...command };
        this.requests.push(fullRequest);
        return this.#execute(fullRequest);
      },
      close: async () => {
        this.closedLeases += 1;
      },
    };
  }

  async execute(request: EvaluationSandboxCommand): Promise<SandboxCommandResult> {
    this.requests.push(request);
    return this.#execute(request);
  }
}
