import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

import { WorkspaceFileError } from "./contracts.js";

function isOutside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference);
}

export function validateRelativeWorkspacePath(path: string, label: string): void {
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

async function deepestExistingAncestor(path: string): Promise<string> {
  let candidate = path;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function resolveWorkspacePath(
  workspacePath: string,
  path: string,
  label: string,
): Promise<string> {
  validateRelativeWorkspacePath(path, label);
  const workspace = resolve(workspacePath);
  const canonicalWorkspace = await realpath(workspace);
  const candidate = resolve(workspace, path);
  if (isOutside(workspace, candidate)) {
    throw new WorkspaceFileError("outside", `${label} must remain inside the workspace.`);
  }
  const ancestor = await deepestExistingAncestor(dirname(candidate));
  if (isOutside(canonicalWorkspace, ancestor)) {
    throw new WorkspaceFileError("outside", `${label} resolves outside the declared workspace.`);
  }
  return candidate;
}

export async function resolveWorkspaceRegularFile(
  workspacePath: string,
  path: string,
  label: string,
): Promise<string> {
  const workspace = resolve(workspacePath);
  const canonicalWorkspace = await realpath(workspace);
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
  if (isOutside(canonicalWorkspace, resolvedCandidate)) {
    throw new WorkspaceFileError("outside", `${label} resolves outside the declared workspace.`);
  }
  if (!(await stat(resolvedCandidate)).isFile()) {
    throw new WorkspaceFileError("not-regular", `${label} must resolve to a regular file.`);
  }
  return resolve(workspace, relative(canonicalWorkspace, resolvedCandidate));
}
