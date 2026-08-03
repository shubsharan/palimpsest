import type { GitRepository, GitRepositoryId } from "../git.js";
import { GitCommandError, runGitCommand } from "../git.js";
import { isAgentId, type AgentId } from "../model/contracts.js";
import type { ObservationEvent } from "../trace.js";
import type { DecodeTiming } from "./contracts.js";

const MAIN_REF = "refs/heads/main";
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

export interface DecodeCheckpointSource {
  originId: GitRepositoryId;
  repositoryPath: string;
  commit: string;
  solverBlob: string;
  atMs: number;
  timing: DecodeTiming;
  authorAgentId?: AgentId;
  author: string;
  subject: string;
  failure?: string;
}

interface CommitMetadata {
  commit: string;
  committedAtMs: number;
  author: string;
  authorEmail: string;
  subject: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactMainUpdates(
  events: readonly ObservationEvent[],
): Map<string, { commit: string; before?: string; atMs: number }[]> {
  const result = new Map<string, { commit: string; before?: string; atMs: number }[]>();
  for (const event of events) {
    if (event.kind !== "git.changed") continue;
    const data = object(event.data);
    if (typeof data?.repositoryId !== "string" || !Array.isArray(data.updates)) continue;
    for (const rawUpdate of data.updates) {
      const update = object(rawUpdate);
      if (
        update?.ref !== MAIN_REF ||
        typeof update.after !== "string" ||
        !OBJECT_ID.test(update.after)
      ) {
        continue;
      }
      const updates = result.get(data.repositoryId) ?? [];
      if (!updates.some(({ commit }) => commit === update.after)) {
        updates.push({
          commit: update.after,
          ...(typeof update.before === "string" && OBJECT_ID.test(update.before)
            ? { before: update.before }
            : {}),
          atMs: event.atMs,
        });
      }
      result.set(data.repositoryId, updates);
    }
  }
  return result;
}

function failedSource(options: {
  repository: GitRepository;
  commit: string;
  atMs: number;
  timing: DecodeTiming;
  error: unknown;
}): DecodeCheckpointSource {
  return {
    originId: options.repository.repositoryId,
    repositoryPath: options.repository.path,
    commit: options.commit,
    solverBlob: "",
    atMs: options.atMs,
    timing: options.timing,
    author: "Unknown author",
    subject: "Recorded main update",
    failure: options.error instanceof Error ? options.error.message : String(options.error),
  };
}

async function metadata(repositoryPath: string, commit: string): Promise<CommitMetadata> {
  const output = await runGitCommand(["show", "-s", "--format=%H%n%ct%n%an%n%ae%n%s", commit], {
    cwd: repositoryPath,
  });
  const [resolvedCommit, timestamp, author, authorEmail, ...subject] = output.stdout
    .trimEnd()
    .split("\n");
  if (
    resolvedCommit === undefined ||
    timestamp === undefined ||
    author === undefined ||
    authorEmail === undefined ||
    !OBJECT_ID.test(resolvedCommit)
  ) {
    throw new Error(`Git returned invalid metadata for checkpoint ${commit}.`);
  }
  return {
    commit: resolvedCommit,
    committedAtMs: Number(timestamp) * 1_000,
    author,
    authorEmail,
    subject: subject.join("\n"),
  };
}

async function solverBlob(repositoryPath: string, commit: string): Promise<string | undefined> {
  try {
    const result = await runGitCommand(["rev-parse", "--verify", `${commit}:solver.py`], {
      cwd: repositoryPath,
    });
    const blob = result.stdout.trim();
    if (!OBJECT_ID.test(blob))
      throw new Error(`Git returned an invalid solver blob for ${commit}.`);
    return blob;
  } catch (error) {
    if (error instanceof GitCommandError) return undefined;
    throw error;
  }
}

function authorAgent(authorEmail: string): AgentId | undefined {
  const candidate = authorEmail.endsWith("@palimpsest.invalid")
    ? authorEmail.slice(0, -"@palimpsest.invalid".length)
    : "";
  return isAgentId(candidate) ? candidate : undefined;
}

async function historicalCommits(repository: GitRepository): Promise<string[]> {
  try {
    const result = await runGitCommand(["rev-list", "--first-parent", "--reverse", MAIN_REF], {
      cwd: repository.path,
    });
    return result.stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error instanceof GitCommandError) return [];
    throw error;
  }
}

export async function discoverDecodeCheckpoints(options: {
  repositories: readonly GitRepository[];
  events: readonly ObservationEvent[];
  startedAt: string;
  durationMs: number;
}): Promise<DecodeCheckpointSource[]> {
  const exact = exactMainUpdates(options.events);
  const checkpoints: DecodeCheckpointSource[] = [];
  for (const repository of options.repositories) {
    const exactUpdates = exact.get(repository.repositoryId);
    const candidates =
      exactUpdates === undefined
        ? (await historicalCommits(repository)).map((commit) => ({ commit }))
        : exactUpdates;
    let previousSolverBlob: string | undefined;
    for (const candidate of candidates) {
      const exactAtMs = (candidate as { atMs?: number }).atMs;
      let commitMetadata: CommitMetadata;
      try {
        commitMetadata = await metadata(repository.path, candidate.commit);
      } catch (error) {
        if (exactAtMs === undefined) throw error;
        checkpoints.push(
          failedSource({
            repository,
            commit: candidate.commit,
            atMs: exactAtMs,
            timing: "exact",
            error,
          }),
        );
        continue;
      }
      if (commitMetadata.authorEmail === "scaffold@palimpsest.invalid") {
        previousSolverBlob = await solverBlob(repository.path, candidate.commit);
        continue;
      }
      const blob = await solverBlob(repository.path, candidate.commit);
      const exactBefore = (candidate as { before?: string }).before;
      const comparisonBlob =
        exactBefore === undefined
          ? previousSolverBlob
          : await solverBlob(repository.path, exactBefore);
      if (blob === comparisonBlob) {
        previousSolverBlob = blob;
        continue;
      }
      if (blob === undefined) {
        if (comparisonBlob !== undefined) {
          checkpoints.push({
            ...failedSource({
              repository,
              commit: commitMetadata.commit,
              atMs:
                exactAtMs ??
                Math.min(
                  options.durationMs,
                  Math.max(0, commitMetadata.committedAtMs - Date.parse(options.startedAt)),
                ),
              timing: exactAtMs === undefined ? "approximate" : "exact",
              error: `solver.py is unavailable at checkpoint ${commitMetadata.commit}.`,
            }),
            author: commitMetadata.author,
            subject: commitMetadata.subject,
          });
        }
        previousSolverBlob = undefined;
        continue;
      }
      previousSolverBlob = blob;
      const approximateAtMs = Math.min(
        options.durationMs,
        Math.max(0, commitMetadata.committedAtMs - Date.parse(options.startedAt)),
      );
      const agentId = authorAgent(commitMetadata.authorEmail);
      checkpoints.push({
        originId: repository.repositoryId,
        repositoryPath: repository.path,
        commit: commitMetadata.commit,
        solverBlob: blob,
        atMs: exactAtMs ?? approximateAtMs,
        timing: exactAtMs === undefined ? "approximate" : "exact",
        ...(agentId === undefined ? {} : { authorAgentId: agentId }),
        author: commitMetadata.author,
        subject: commitMetadata.subject,
      });
    }
  }
  return checkpoints.sort(
    (left, right) => left.atMs - right.atMs || left.originId.localeCompare(right.originId),
  );
}
