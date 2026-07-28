import {
  type CommandSandbox,
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
  readonly #execute: (request: SandboxCommand) => Promise<SandboxCommandResult>;

  constructor(
    execute: (request: SandboxCommand) => Promise<SandboxCommandResult> = async () => SUCCESS,
  ) {
    this.#execute = execute;
  }

  async execute(request: SandboxCommand): Promise<SandboxCommandResult> {
    this.requests.push(request);
    return this.#execute(request);
  }
}
