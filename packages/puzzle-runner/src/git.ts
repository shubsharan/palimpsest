import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { ActivityBus } from "./activity.js";
import { AGENT_IDS, type AgentId } from "./config.js";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AgentGitWorkspace {
  agentId: AgentId;
  path: string;
}

export interface GitEnvironment {
  root: string;
  barePath: string;
  workspaces: readonly AgentGitWorkspace[];
}

export interface FrozenGitEnvironment extends GitEnvironment {
  frozen: true;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  if (process.env.PATH !== undefined) environment.PATH = process.env.PATH;
  if (process.env.TMPDIR !== undefined) environment.TMPDIR = process.env.TMPDIR;
  return environment;
}

export function runGit(args: readonly string[], cwd?: string): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env: commandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 1,
      };
      if (signal !== null || code !== 0) {
        reject(
          new Error(
            `git ${args.join(" ")} failed${signal === null ? ` with exit ${String(code)}` : ` from ${signal}`}: ${result.stderr.trim()}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

export async function createGitEnvironment(root: string): Promise<GitEnvironment> {
  const barePath = join(root, "shared.git");
  const workspaceRoot = join(root, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  await runGit(["init", "--bare", "--initial-branch=main", barePath]);
  const workspaces = await Promise.all(
    AGENT_IDS.map(async (agentId) => {
      const path = join(workspaceRoot, agentId);
      await runGit(["clone", barePath, path]);
      await runGit(["config", "user.name", `Palimpsest ${agentId}`], path);
      await runGit(["config", "user.email", `${agentId}@palimpsest.invalid`], path);
      return { agentId, path };
    }),
  );
  return { root, barePath, workspaces };
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
  readonly #barePath: string;
  readonly #activity: ActivityBus;
  readonly #pollIntervalMs: number;
  readonly #onChange: ((refs: readonly string[]) => void | Promise<void>) | undefined;
  #running = false;
  #loop: Promise<void> | undefined;
  #stopController: AbortController | undefined;
  #snapshot: Record<string, string> = {};

  constructor(options: {
    barePath: string;
    activity: ActivityBus;
    pollIntervalMs?: number;
    onChange?: (refs: readonly string[]) => void | Promise<void>;
  }) {
    this.#barePath = options.barePath;
    this.#activity = options.activity;
    this.#pollIntervalMs = options.pollIntervalMs ?? 100;
    this.#onChange = options.onChange;
  }

  async start(): Promise<void> {
    if (this.#running) throw new Error("Git activity monitor is already running.");
    this.#snapshot = await listRemoteRefs(this.#barePath);
    this.#running = true;
    this.#stopController = new AbortController();
    this.#loop = this.#poll(this.#stopController.signal);
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#stopController?.abort();
    await this.#loop;
  }

  async checkNow(): Promise<readonly string[]> {
    const next = await listRemoteRefs(this.#barePath);
    const refs = changedRefs(this.#snapshot, next);
    this.#snapshot = next;
    if (refs.length > 0) {
      this.#activity.publish({ kind: "git-changed", detail: { refs } });
      await this.#onChange?.(refs);
    }
    return refs;
  }

  async #poll(signal: AbortSignal): Promise<void> {
    while (this.#running) {
      await waitInterval(this.#pollIntervalMs, signal);
      if (!this.#running) break;
      await this.checkNow();
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
  const barePath = join(targetRoot, "shared.git");
  const workspaceRoot = join(targetRoot, "workspaces");
  await mkdir(targetRoot, { recursive: false });
  await cp(environment.barePath, barePath, { recursive: true, errorOnExist: true, force: false });
  const workspaces = await Promise.all(
    environment.workspaces.map(async (workspace) => {
      const path = join(workspaceRoot, workspace.agentId);
      await cp(workspace.path, path, { recursive: true, errorOnExist: true, force: false });
      return { agentId: workspace.agentId, path };
    }),
  );
  await makeReadOnly(targetRoot);
  return { root: targetRoot, barePath, workspaces, frozen: true };
}
