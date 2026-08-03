import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGitEnvironment, listRemoteRefs, runGit } from "../git.js";
import type { AgentId } from "../model/contracts.js";
import type { ObservationEvent } from "../trace.js";
import { discoverDecodeCheckpoints } from "./git-checkpoints.js";

const AGENTS = ["agent-1", "agent-2", "agent-3"] as const satisfies readonly AgentId[];

describe("decode checkpoint discovery", () => {
  it("uses exact observed main targets and skips commits that do not change solver.py", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-viewer-git-"));
    const environment = await createGitEnvironment(root, "shared", AGENTS);
    const workspace = environment.workspaces[0]!;
    const repository = environment.repositories[0]!;
    const before = (await listRemoteRefs(repository.path))["refs/heads/main"]!;
    await writeFile(join(workspace.path, "solver.py"), "print('first')\n", "utf8");
    await runGit(["add", "solver.py"], workspace.path);
    await runGit(["commit", "-m", "first solver"], workspace.path);
    await runGit(["push", repository.path, "HEAD:main"], workspace.path);
    const solverCommit = (await listRemoteRefs(repository.path))["refs/heads/main"]!;
    await writeFile(join(workspace.path, "notes.txt"), "observation\n", "utf8");
    await runGit(["add", "notes.txt"], workspace.path);
    await runGit(["commit", "-m", "notes only"], workspace.path);
    await runGit(["push", repository.path, "HEAD:main"], workspace.path);
    const notesCommit = (await listRemoteRefs(repository.path))["refs/heads/main"]!;
    const events: ObservationEvent[] = [
      {
        sequence: 1,
        atMs: 1_000,
        kind: "git.changed",
        data: {
          repositoryId: "shared",
          refs: ["refs/heads/main"],
          updates: [{ ref: "refs/heads/main", before, after: solverCommit }],
        },
      },
      {
        sequence: 2,
        atMs: 2_000,
        kind: "git.changed",
        data: {
          repositoryId: "shared",
          refs: ["refs/heads/main"],
          updates: [{ ref: "refs/heads/main", before: solverCommit, after: notesCommit }],
        },
      },
    ];

    const checkpoints = await discoverDecodeCheckpoints({
      repositories: environment.repositories,
      events,
      startedAt: new Date().toISOString(),
      durationMs: 10_000,
    });

    expect(checkpoints).toEqual([
      expect.objectContaining({
        originId: "shared",
        commit: solverCommit,
        atMs: 1_000,
        timing: "exact",
        authorAgentId: "agent-1",
        subject: "first solver",
      }),
    ]);
  });

  it("marks reachable historical main commits as approximate", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-viewer-history-"));
    const environment = await createGitEnvironment(root, "shared", AGENTS);
    const workspace = environment.workspaces[0]!;
    await writeFile(join(workspace.path, "solver.py"), "print('historical')\n", "utf8");
    await runGit(["add", "solver.py"], workspace.path);
    await runGit(["commit", "-m", "historical solver"], workspace.path);
    await runGit(["push", environment.repositories[0]!.path, "HEAD:main"], workspace.path);

    const checkpoints = await discoverDecodeCheckpoints({
      repositories: environment.repositories,
      events: [],
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      durationMs: 20_000,
    });

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ timing: "approximate", subject: "historical solver" });
  });

  it("retains an exact checkpoint when the recorded commit is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-viewer-missing-"));
    const environment = await createGitEnvironment(root, "shared", AGENTS);
    const missingCommit = "f".repeat(40);

    const checkpoints = await discoverDecodeCheckpoints({
      repositories: environment.repositories,
      events: [
        {
          sequence: 1,
          atMs: 5_000,
          kind: "git.changed",
          data: {
            repositoryId: "shared",
            refs: ["refs/heads/main"],
            updates: [{ ref: "refs/heads/main", before: null, after: missingCommit }],
          },
        },
      ],
      startedAt: new Date().toISOString(),
      durationMs: 10_000,
    });

    expect(checkpoints).toEqual([
      expect.objectContaining({
        commit: missingCommit,
        atMs: 5_000,
        timing: "exact",
        failure: expect.stringContaining("failed"),
      }),
    ]);
  });
});
