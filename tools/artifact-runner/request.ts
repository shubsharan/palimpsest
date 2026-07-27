import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ReferenceRequest } from "./types.js";

const execFileAsync = promisify(execFile);

interface CreateReferenceRequestOptions {
  deadlineMs?: number;
  message: string;
}

export async function createReferenceRequest(
  options: CreateReferenceRequestOptions,
): Promise<ReferenceRequest> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    schemaVersion: 1,
    requestId: "milestone-1-reference-producer",
    producer: {
      name: "reference-producer",
      allowedVersions: ["1.0.0"],
    },
    immutableInputs: [],
    deadlineMs: options.deadlineMs ?? 5_000,
    environment: {
      node: "26.5.0",
      pnpm: "10.14.0",
      python: "3.12.4",
      uv: "0.11.14",
      git: "2.48.1",
      platform: `${process.platform}-${process.arch}`,
      revision: stdout.trim(),
    },
    payload: {
      message: options.message,
    },
  };
}
