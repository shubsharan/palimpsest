import { spawn } from "node:child_process";

import {
  ContractInputError,
  canonicalJsonBytes,
  parseJsonStrict,
  validateValue,
} from "@palimpsest/contracts";

import {
  ArtifactRunError,
  type ArtifactResponseManifest,
  type FailureMode,
  type ProgressRecord,
} from "./types.js";

interface NetworkSandbox {
  args: string[];
  command: string;
  label: string;
}

interface ProducerProcessOptions {
  deadlineMs: number;
  mode: FailureMode;
  outputPath: string;
  requestPath: string;
}

interface ProducerProcessResult {
  records: ProgressRecord[];
  stderr: string;
}

const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

function isArtifactResponseManifest(value: unknown): value is ArtifactResponseManifest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    validateValue("artifact-response-manifest", value).accepted
  );
}

export function networkSandboxForCurrentPlatform(): NetworkSandbox {
  if (process.platform === "darwin") {
    return {
      args: ["-p", "(version 1)(allow default)(deny network*)"],
      command: "/usr/bin/sandbox-exec",
      label: "macos-sandbox-exec-network-deny",
    };
  }
  if (process.platform === "linux") {
    return {
      args: ["--net", "--"],
      command: "unshare",
      label: "linux-unshare-network-namespace",
    };
  }
  throw new ArtifactRunError(
    "unsupported_environment",
    `No network-denial adapter is defined for ${process.platform}.`,
  );
}

function parseProgress(stdout: string): ProgressRecord[] {
  if (!stdout.endsWith("\n")) {
    throw new ArtifactRunError("truncated_progress", "Progress stream does not end with LF.");
  }
  const lines = stdout.slice(0, -1).split("\n");
  const records: ProgressRecord[] = [];
  for (const [index, line] of lines.entries()) {
    let value;
    try {
      value = parseJsonStrict(line);
    } catch (error) {
      const diagnostics = error instanceof ContractInputError ? error.message : String(error);
      throw new ArtifactRunError(
        "malformed_progress",
        `Progress record ${index} is invalid.`,
        diagnostics,
      );
    }
    if (canonicalJsonBytes(value).toString("utf8") !== line) {
      throw new ArtifactRunError(
        "malformed_progress",
        `Progress record ${index} is not canonical JSON.`,
      );
    }
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.schemaVersion !== 1 ||
      value.sequence !== index ||
      typeof value.requestDigest !== "string" ||
      (value.kind !== "started" && value.kind !== "completed")
    ) {
      throw new ArtifactRunError(
        "malformed_progress",
        `Progress record ${index} has an invalid envelope.`,
      );
    }
    const responseManifest = value.responseManifest;
    if (responseManifest !== undefined && !isArtifactResponseManifest(responseManifest)) {
      throw new ArtifactRunError(
        "malformed_progress",
        `Progress record ${index} has an invalid response manifest.`,
      );
    }
    records.push({
      schemaVersion: 1,
      sequence: value.sequence,
      requestDigest: value.requestDigest,
      kind: value.kind,
      ...(responseManifest === undefined ? {} : { responseManifest }),
    });
  }

  if (records[0]?.kind !== "started") {
    throw new ArtifactRunError("malformed_progress", "Progress stream must begin with started.");
  }
  const terminal = records.at(-1);
  if (terminal?.kind !== "completed" || !terminal.responseManifest) {
    throw new ArtifactRunError(
      "truncated_progress",
      "Progress stream has no complete terminal record.",
    );
  }
  if (records.slice(0, -1).some((record) => record.kind === "completed")) {
    throw new ArtifactRunError(
      "malformed_progress",
      "Progress stream contains records after termination.",
    );
  }
  return records;
}

export async function runProducerProcess(
  options: ProducerProcessOptions,
): Promise<ProducerProcessResult> {
  const sandbox = networkSandboxForCurrentPlatform();
  const producerArgs = [
    ...sandbox.args,
    "uv",
    "run",
    "--offline",
    "--frozen",
    "--project",
    "python",
    "python",
    "-m",
    "palimpsest.evidence.reference_producer",
    "--request",
    options.requestPath,
    "--output",
    options.outputPath,
    "--mode",
    options.mode,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(sandbox.command, producerArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PALIMPSEST_NETWORK_ISOLATION: sandbox.label,
        UV_OFFLINE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let outputLimitExceeded = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.deadlineMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(deadline);
      reject(
        new ArtifactRunError(
          "unsupported_environment",
          `Failed to launch network-isolated producer: ${error.message}`,
        ),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      const diagnostics = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(
          new ArtifactRunError("deadline_exceeded", "Producer exceeded its deadline.", diagnostics),
        );
        return;
      }
      if (outputLimitExceeded) {
        reject(
          new ArtifactRunError(
            "malformed_progress",
            "Producer exceeded the progress or diagnostic stream limit.",
            diagnostics,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new ArtifactRunError(
            "producer_exit",
            `Producer exited with code ${String(code)} and signal ${String(signal)}.`,
            diagnostics,
          ),
        );
        return;
      }
      try {
        resolve({
          records: parseProgress(Buffer.concat(stdout).toString("utf8")),
          stderr: diagnostics,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
