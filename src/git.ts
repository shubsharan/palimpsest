import { chmod, cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentId } from "./model/contracts.js";
import { runProcess } from "./process.js";
import { InfrastructureError, SANDBOX_PATHS } from "./sandbox/contracts.js";
import { sealTree, type TreeSeal } from "./seal.js";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitCommandOptions {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  deadline?: number;
  signal?: AbortSignal;
}

export class GitCommandError extends Error {
  override readonly name = "GitCommandError";
}

export class GitCommandTimeoutError extends InfrastructureError {
  override readonly name = "GitCommandTimeoutError";
  override readonly component = "host-git";
}

export class GitProcessInfrastructureError extends InfrastructureError {
  override readonly name = "GitProcessInfrastructureError";
  override readonly component = "host-git";
}

export interface AgentGitWorkspace {
  agentId: AgentId;
  path: string;
  repositoryId: GitRepositoryId;
}

export type GitCommunicationMode = "shared" | "isolated";
export type GitRepositoryId = "shared" | AgentId;

export interface GitRepository {
  repositoryId: GitRepositoryId;
  path: string;
  agentIds: readonly AgentId[];
}

export interface GitEnvironment {
  root: string;
  communicationMode: GitCommunicationMode;
  repositories: readonly GitRepository[];
  workspaces: readonly AgentGitWorkspace[];
}

export interface FrozenGitEnvironment extends GitEnvironment {
  frozen: true;
  treeSeal: TreeSeal;
}

export const SOLVER_SCAFFOLD = `import os
from pathlib import Path


def solve(ciphertext: str) -> str:
    return ciphertext


if __name__ == "__main__":
    source = Path(os.environ["PALIMPSEST_CIPHERTEXT"])
    destination = Path(os.environ["PALIMPSEST_OUTPUT"])
    destination.write_text(solve(source.read_text(encoding="utf-8")), encoding="utf-8")
`;

function commandEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  if (process.env.PATH !== undefined) environment.PATH = process.env.PATH;
  if (process.env.TMPDIR !== undefined) environment.TMPDIR = process.env.TMPDIR;
  return { ...environment, ...overrides };
}

export function runGitCommand(
  args: readonly string[],
  options: GitCommandOptions = {},
): Promise<GitCommandResult> {
  return runProcess("git", args, {
    cwd: options.cwd ?? process.cwd(),
    env: commandEnvironment(options.environment),
    ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }).then(
    (captured) => {
      const result = {
        stdout: captured.stdout.toString("utf8"),
        stderr: captured.stderr.toString("utf8"),
        exitCode: captured.exitCode ?? 1,
      };
      if (captured.cancelled) {
        throw new DOMException("Git command was cancelled.", "AbortError");
      }
      if (captured.timedOut) {
        throw new GitCommandTimeoutError(`git ${args.join(" ")} exceeded its deadline.`);
      }
      if (captured.signal !== null || result.exitCode !== 0) {
        throw new GitCommandError(
          `git ${args.join(" ")} failed${captured.signal === null ? ` with exit ${String(captured.exitCode)}` : ` from ${captured.signal}`}: ${result.stderr.trim()}`,
        );
      }
      return result;
    },
    (error: unknown) => {
      throw new GitProcessInfrastructureError(
        `Unable to execute host git process: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    },
  );
}

export function runGit(
  args: readonly string[],
  cwd?: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<GitCommandResult> {
  return runGitCommand(args, {
    environment,
    ...(cwd === undefined ? {} : { cwd }),
  });
}

const SCAFFOLD_COMMIT_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "Palimpsest",
  GIT_AUTHOR_EMAIL: "scaffold@palimpsest.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Palimpsest",
  GIT_COMMITTER_EMAIL: "scaffold@palimpsest.invalid",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
} as const;

async function seedSolverScaffold(root: string, repository: GitRepository): Promise<void> {
  const seed = await mkdtemp(join(root, ".scaffold-"));
  try {
    await runGit(["clone", repository.path, seed]);
    await writeFile(join(seed, "solver.py"), SOLVER_SCAFFOLD, { encoding: "utf8", flag: "wx" });
    await runGit(["add", "solver.py"], seed);
    await runGit(["commit", "-m", "Initialize solver scaffold"], seed, SCAFFOLD_COMMIT_ENVIRONMENT);
    await runGit(["push", repository.path, "HEAD:main"], seed);
  } finally {
    await rm(seed, { recursive: true, force: true });
  }
}

export async function createGitEnvironment(
  root: string,
  communicationMode: GitCommunicationMode,
  agentIds: readonly AgentId[],
): Promise<GitEnvironment> {
  if (agentIds.length < 2 || new Set(agentIds).size !== agentIds.length) {
    throw new Error("Git environment requires at least two unique agent IDs.");
  }
  const resolvedRoot = resolve(root);
  const workspaceRoot = join(resolvedRoot, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const repositories: GitRepository[] =
    communicationMode === "shared"
      ? [
          {
            repositoryId: "shared",
            path: join(resolvedRoot, "shared.git"),
            agentIds: [...agentIds],
          },
        ]
      : agentIds.map((agentId) => ({
          repositoryId: agentId,
          path: join(resolvedRoot, `${agentId}.git`),
          agentIds: [agentId],
        }));
  await Promise.all(
    repositories.map((repository) =>
      runGit(["init", "--bare", "--initial-branch=main", repository.path]),
    ),
  );
  await Promise.all(repositories.map((repository) => seedSolverScaffold(resolvedRoot, repository)));
  const workspaces = await Promise.all(
    agentIds.map(async (agentId) => {
      const repository = repositories.find((candidate) => candidate.agentIds.includes(agentId));
      if (repository === undefined) {
        throw new Error(`Git repository assignment is missing for ${agentId}.`);
      }
      const path = join(workspaceRoot, agentId);
      await runGit(["clone", repository.path, path]);
      await runGit(["config", "user.name", `Palimpsest ${agentId}`], path);
      await runGit(["config", "user.email", `${agentId}@palimpsest.invalid`], path);
      await runGit(["remote", "set-url", "origin", SANDBOX_PATHS.gitOrigin], path);
      return { agentId, path, repositoryId: repository.repositoryId };
    }),
  );
  return { root: resolvedRoot, communicationMode, repositories, workspaces };
}

export async function listRemoteRefs(barePath: string): Promise<Record<string, string>> {
  const { stdout } = await runGit(
    ["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/"],
    barePath,
  );
  const result: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf("\t");
    if (separator < 1) throw new Error(`Git returned an invalid ref record: ${line}`);
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function changedRefs(before: Record<string, string>, after: Record<string, string>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

function waitInterval(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class GitActivityMonitor {
  readonly #repository: GitRepository;
  readonly #pollIntervalMs: number;
  readonly #onChange:
    | ((
        repositoryId: GitRepositoryId,
        agentIds: readonly AgentId[],
        refs: readonly string[],
      ) => void | Promise<void>)
    | undefined;
  readonly #onError: ((error: unknown) => void | Promise<void>) | undefined;
  #running = false;
  #loop: Promise<void> | undefined;
  #stopController: AbortController | undefined;
  #snapshot: Record<string, string> = {};

  constructor(options: {
    repository: GitRepository;
    pollIntervalMs?: number;
    onChange?: (
      repositoryId: GitRepositoryId,
      agentIds: readonly AgentId[],
      refs: readonly string[],
    ) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }) {
    this.#repository = options.repository;
    this.#pollIntervalMs = options.pollIntervalMs ?? 100;
    this.#onChange = options.onChange;
    this.#onError = options.onError;
  }

  async start(): Promise<void> {
    if (this.#running) throw new Error("Git activity monitor is already running.");
    this.#snapshot = await listRemoteRefs(this.#repository.path);
    this.#running = true;
    this.#stopController = new AbortController();
    this.#loop = this.#poll(this.#stopController.signal);
    void this.#loop.catch(() => {});
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#stopController?.abort();
    await this.#loop;
  }

  async checkNow(): Promise<readonly string[]> {
    const next = await listRemoteRefs(this.#repository.path);
    const refs = changedRefs(this.#snapshot, next);
    if (refs.length > 0) {
      await this.#onChange?.(this.#repository.repositoryId, this.#repository.agentIds, refs);
    }
    this.#snapshot = next;
    return refs;
  }

  async #poll(signal: AbortSignal): Promise<void> {
    try {
      while (this.#running) {
        await waitInterval(this.#pollIntervalMs, signal);
        if (!this.#running) break;
        await this.checkNow();
      }
    } catch (error) {
      this.#running = false;
      await this.#onError?.(error);
      throw error;
    }
  }
}

async function makeReadOnly(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await makeReadOnly(child);
      } else if (!entry.isSymbolicLink()) {
        const metadata = await stat(child);
        await chmod(child, metadata.mode & 0o555);
      }
    }),
  );
  await chmod(path, 0o555);
}

export async function freezeGitEnvironment(
  environment: GitEnvironment,
  targetRoot: string,
): Promise<FrozenGitEnvironment> {
  const resolvedTargetRoot = resolve(targetRoot);
  const workspaceRoot = join(resolvedTargetRoot, "workspaces");
  await mkdir(resolvedTargetRoot, { recursive: false });
  const repositories = await Promise.all(
    environment.repositories.map(async (repository) => {
      const path = join(
        resolvedTargetRoot,
        repository.repositoryId === "shared" ? "shared.git" : `${repository.repositoryId}.git`,
      );
      await cp(repository.path, path, { recursive: true, errorOnExist: true, force: false });
      return { ...repository, path };
    }),
  );
  const workspaces = await Promise.all(
    environment.workspaces.map(async (workspace) => {
      const path = join(workspaceRoot, workspace.agentId);
      await cp(workspace.path, path, { recursive: true, errorOnExist: true, force: false });
      return { ...workspace, path };
    }),
  );
  await makeReadOnly(resolvedTargetRoot);
  return {
    root: resolvedTargetRoot,
    communicationMode: environment.communicationMode,
    repositories,
    workspaces,
    frozen: true,
    treeSeal: await sealTree(resolvedTargetRoot),
  };
}
