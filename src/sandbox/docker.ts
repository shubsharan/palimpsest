import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

import {
  SANDBOX_CONTAINER_LABEL,
  SANDBOX_DOCKERFILE_PATH,
  SANDBOX_IMAGE_TAG,
  SANDBOX_PATHS,
  SANDBOX_POLICY,
  SANDBOX_PROFILE_LABEL,
  SANDBOX_SOURCE_LABEL,
  SandboxInfrastructureError,
  type AgentSandboxLeaseRequest,
  type BaseSandboxCommand,
  type SandboxCommand,
  type SandboxIdentity,
  validateSandboxCommand,
} from "./contracts.js";
import { validateRelativeWorkspacePath } from "./workspace.js";

export interface DockerImageInspection {
  Id?: unknown;
  Config?: {
    Labels?: Record<string, string> | null;
  };
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sandboxDockerfileDigest(root = process.cwd()): Promise<string> {
  return createHash("sha256")
    .update(await readFile(join(resolve(root), SANDBOX_DOCKERFILE_PATH)))
    .digest("hex");
}

export function parseSandboxImageInspection(source: string): DockerImageInspection {
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
  validateSandboxCommand(request);
  const mounts: Array<{ source: string; target: string; readOnly: boolean }> = [];
  const environment = ["LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TMPDIR=/tmp"];
  let workdir: string;

  if (request.profile === "agent") {
    mounts.push({
      source: await requireMountSource(request.workspacePath, "directory", "workspace"),
      target: SANDBOX_PATHS.workspace,
      readOnly: false,
    });
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
        source: await requireMountSource(request.gitOriginPath, "directory", "Git origin"),
        target: SANDBOX_PATHS.gitOrigin,
        readOnly: false,
      },
    );
    environment.unshift("HOME=/workspace");
    environment.push("GIT_TERMINAL_PROMPT=0");
    workdir = SANDBOX_PATHS.workspace;
  } else {
    validateRelativeWorkspacePath(request.outputPath, "Reviewer outputPath");
    mounts.push(
      {
        source: await requireMountSource(request.submissionPath, "directory", "submission"),
        target: SANDBOX_PATHS.submission,
        readOnly: true,
      },
      {
        source: await requireMountSource(request.ciphertextPath, "file", "ciphertext"),
        target: SANDBOX_PATHS.ciphertext,
        readOnly: true,
      },
      {
        source: await requireMountSource(request.outputRoot, "directory", "output"),
        target: SANDBOX_PATHS.output,
        readOnly: false,
      },
    );
    environment.unshift("HOME=/tmp");
    environment.push(
      `PALIMPSEST_CIPHERTEXT=${SANDBOX_PATHS.ciphertext}`,
      `PALIMPSEST_OUTPUT=${posix.join(SANDBOX_PATHS.output, request.outputPath)}`,
    );
    workdir = SANDBOX_PATHS.submission;
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
    workdir,
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

export function buildDockerExecArguments(
  request: BaseSandboxCommand,
  containerName: string,
  user: { uid: number; gid: number },
): string[] {
  validateSandboxCommand(request);
  return [
    "exec",
    "--workdir",
    SANDBOX_PATHS.workspace,
    "--user",
    `${String(user.uid)}:${String(user.gid)}`,
    containerName,
    "/usr/bin/env",
    "-i",
    "HOME=/workspace",
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8",
    "TMPDIR=/tmp",
    "GIT_TERMINAL_PROMPT=0",
    "/bin/sh",
    "-lc",
    request.command,
  ];
}

export function buildAgentDockerCreateArguments(
  request: AgentSandboxLeaseRequest,
  identity: SandboxIdentity,
  containerName: string,
  user: { uid: number; gid: number },
  containerLabelValue = "1",
): Promise<string[]> {
  return buildDockerCreateArguments(
    {
      profile: "agent",
      command: "while :; do sleep 3600; done",
      timeoutMs: request.timeoutMs,
      workspacePath: request.workspacePath,
      evidencePath: request.evidencePath,
      referenceCorpusPath: request.referenceCorpusPath,
      gitOriginPath: request.gitOriginPath,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    },
    identity,
    containerName,
    user,
    containerLabelValue,
  );
}
