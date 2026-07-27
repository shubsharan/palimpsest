import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { networkSandboxForCurrentPlatform } from "../artifact-runner/subprocess.js";

interface RelayCodecResult {
  accessedInputs: string[];
  decodedByteLength: number;
  encoded: Buffer;
  encodedByteLength: number;
  exactReconstruction: boolean;
  networkIsolation: string;
  strategyId: string;
}

interface RunRelayCodecOptions {
  fixtureMetadataPath: string;
  opaquePath: string;
  sourceRoot: string;
  strategyId: string;
}

export function runNetworkIsolated(
  command: string,
  args: string[],
  deadlineMs = 120_000,
): Promise<void> {
  const sandbox = networkSandboxForCurrentPlatform();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(sandbox.command, [...sandbox.args, command, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PALIMPSEST_NETWORK_ISOLATION: sandbox.label,
        UV_OFFLINE: "1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, deadlineMs);
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (timedOut) {
        reject(new Error(`Relay codec exceeded its ${deadlineMs} ms deadline.`));
      } else if (code !== 0) {
        reject(
          new Error(
            `Relay codec exited ${String(code)}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      } else {
        resolvePromise();
      }
    });
  });
}

export async function runRelayCodec(options: RunRelayCodecOptions): Promise<RelayCodecResult> {
  const attemptRoot = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-codec-"));
  const encodedPath = join(attemptRoot, "encoded.bin");
  const resultPath = join(attemptRoot, "result.json");
  const sandbox = networkSandboxForCurrentPlatform();
  try {
    if (options.strategyId === "brotli-text-11" || options.strategyId === "zstandard-22") {
      await runNetworkIsolated("node", [
        "--experimental-strip-types",
        "tools/gate-a/node-codec-worker.ts",
        options.strategyId,
        options.opaquePath,
        encodedPath,
        resultPath,
      ]);
    } else {
      await runNetworkIsolated("uv", [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.channel.relay_codec",
        "--metadata",
        options.fixtureMetadataPath,
        "--opaque",
        options.opaquePath,
        "--sources",
        options.sourceRoot,
        "--strategy",
        options.strategyId,
        "--encoded",
        encodedPath,
        "--result",
        resultPath,
      ]);
    }
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    const encoded = await readFile(encodedPath);
    if (
      result.encodedByteLength !== encoded.length ||
      result.strategyId !== options.strategyId ||
      result.exactReconstruction !== true
    ) {
      throw new Error(`Relay codec result is inconsistent for ${options.strategyId}.`);
    }
    return {
      ...result,
      encoded,
      networkIsolation: sandbox.label,
    };
  } finally {
    await rm(attemptRoot, { force: true, recursive: true });
  }
}
