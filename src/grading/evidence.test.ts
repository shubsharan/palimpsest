import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCompletedRunFixture,
  createIsolatedRunFixture,
} from "../../tests/support/grading-fixture.js";
import { compileEvidence, EVIDENCE_EXCERPT_BYTES, EVIDENCE_WINDOW_BYTES } from "./evidence.js";

describe("reviewer-safe evidence compilation", () => {
  it("orders evidence, anonymizes actors, and excludes identities, oracle data, and outcomes", async () => {
    const fixture = await createCompletedRunFixture({
      runId: "identity-bearing-run",
      observations: [
        {
          kind: "model.response",
          agentId: "agent-1",
          atMs: 4,
          data: {
            responseIdentity: { provider: "private-provider", model: "private-model" },
            reasoningSummary: "Agent agent-1 tested a repeated token.",
          },
        },
        {
          kind: "team.message",
          atMs: 5,
          data: { sequence: 1, author: "agent-2", message: "I checked the candidate." },
        },
        {
          kind: "evaluation.completed",
          atMs: 6,
          data: { score: { matchedWords: 10, totalWords: 10, accuracy: 1 }, success: true },
        },
      ],
    });
    await writeFile(fixture.textPath, "must remain byte-stable\n", "utf8");

    const first = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const second = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const encoded = JSON.stringify(first.bundle);

    expect(first.bundle).toEqual(second.bundle);
    expect(first.bundle.actors).toEqual(["actor-1", "actor-2"]);
    expect(
      first.bundle.items
        .map(({ atMs }) => atMs)
        .every((value, index, values) => index === 0 || value >= values[index - 1]!),
    ).toBe(true);
    expect(encoded).not.toContain("agent-1");
    expect(encoded).not.toContain("agent-2");
    expect(encoded).not.toContain("private-provider");
    expect(encoded).not.toContain("private-model");
    expect(encoded).not.toContain("identity-bearing-run");
    expect(encoded).not.toContain("matchedWords");
    expect(first.bundle.items.some(({ kind }) => kind === "evaluation.completed")).toBe(false);
    expect(first.bundle.omissions.some(({ reason }) => reason.includes("final outcome"))).toBe(
      true,
    );
    expect(await readFile(fixture.textPath, "utf8")).toBe("must remain byte-stable\n");
  });

  it("bounds payload excerpts and creates deterministic complete chronological windows", async () => {
    const fixture = await createCompletedRunFixture({
      observations: Array.from({ length: 30 }, (_, index) => ({
        kind: "model.response",
        agentId: index % 2 === 0 ? ("agent-1" as const) : ("agent-2" as const),
        atMs: index + 1,
        data: { reasoningSummary: `${String(index)}:${"x".repeat(10_000)}` },
      })),
    });

    const { bundle } = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const covered = bundle.windows.flatMap(({ evidenceIds }) => evidenceIds);

    expect(bundle.items.filter(({ availability }) => availability === "excerpted").length).toBe(30);
    expect(
      bundle.items.every(({ content }) =>
        typeof content === "string"
          ? Buffer.byteLength(content) <= EVIDENCE_EXCERPT_BYTES
          : Buffer.byteLength(JSON.stringify(content)) <= EVIDENCE_EXCERPT_BYTES,
      ),
    ).toBe(true);
    expect(covered).toEqual(bundle.items.map(({ evidenceId }) => evidenceId));
    expect(new Set(covered).size).toBe(covered.length);
    expect(bundle.windows.length).toBeGreaterThan(1);
    expect(bundle.windows.every(({ byteCount }) => byteCount <= EVIDENCE_WINDOW_BYTES)).toBe(true);
    expect(bundle.omissions.filter(({ reason }) => reason.includes("excerpted"))).toHaveLength(30);
  });

  it("anonymizes isolated Git origins while retaining every canonical consequence", async () => {
    const fixture = await createIsolatedRunFixture();

    const { bundle } = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const canonical = bundle.items.filter(({ kind }) => kind === "git.canonical");

    expect(canonical).toHaveLength(2);
    expect(canonical.map(({ reference }) => reference)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "git", originId: "origin-1" }),
        expect.objectContaining({ source: "git", originId: "origin-2" }),
      ]),
    );
    expect(JSON.stringify(bundle)).not.toMatch(/agent-[12]/);
    expect(bundle.items.filter(({ kind }) => kind === "git.solver-snapshot")).toHaveLength(2);
  });

  it("attributes production and legacy team messages to their observable authors", async () => {
    const fixture = await createCompletedRunFixture({
      observations: [
        {
          kind: "team.message",
          atMs: 1,
          data: {
            sequence: 1,
            author: "agent-1",
            message: "Try the competing mapping.",
            occurredAtMs: 1,
          },
        },
        {
          kind: "team.message",
          agentId: "agent-2",
          atMs: 2,
          data: { message: "Legacy attributed message." },
        },
      ],
    });

    const { bundle } = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const messages = bundle.items.filter(({ kind }) => kind === "team.message");

    expect(messages.map(({ actorId }) => actorId)).toEqual(["actor-1", "actor-2"]);
    expect(messages[0]!.content).toMatchObject({ author: "actor-1" });
  });

  it.each([
    [
      "conflicting",
      { kind: "team.message", agentId: "agent-2", data: { author: "agent-1", message: "x" } },
      /conflicting team-message authors/i,
    ],
    [
      "unknown",
      { kind: "team.message", data: { author: "agent-9", message: "x" } },
      /unknown team-message author/i,
    ],
  ] as const)("rejects %s team-message authors", async (_name, observation, expected) => {
    const fixture = await createCompletedRunFixture({ observations: [observation] });

    await expect(compileEvidence({ root: fixture.root, runRoot: fixture.runRoot })).rejects.toThrow(
      expected,
    );
  });

  it("includes only the bounded, blinded canonical solver with a stable Git citation", async () => {
    const fixture = await createCompletedRunFixture({
      publishedFiles: {
        shared: {
          "solver.py":
            'MODEL = "synthetic-review-neutral-model"\nprint("canonical solver evidence")\n',
          "unrelated-notes.txt": "must never enter reviewer evidence\n",
        },
      },
    });

    const first = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const second = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const solver = first.bundle.items.find(({ kind }) => kind === "git.solver-snapshot")!;
    const encoded = JSON.stringify(first.bundle);

    expect(solver).toEqual(
      second.bundle.items.find(({ evidenceId }) => evidenceId === solver.evidenceId),
    );
    expect(solver.actorId).toBe("runner");
    expect(solver.content).toContain("canonical solver evidence");
    expect(solver.content).toContain("[redacted-identity]");
    expect(solver.reference).toEqual({
      source: "git",
      originId: "origin-1",
      commit: fixture.record.topology.origins[0]!.mainCommit,
      path: "solver.py",
      excerptDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      role: "context",
    });
    expect(encoded).not.toContain("synthetic-review-neutral-model");
    expect(encoded).not.toContain("must never enter reviewer evidence");
  });

  it("records explicit canonical solver omissions for absent main, missing, oversized, and outcome-bearing content", async () => {
    const [absentMain, missing, oversized, outcome] = await Promise.all([
      createCompletedRunFixture({ originsWithoutMain: ["shared"] }),
      createCompletedRunFixture({ publishedFiles: { shared: { "solver.py": null } } }),
      createCompletedRunFixture({
        publishedFiles: { shared: { "solver.py": "x".repeat(EVIDENCE_EXCERPT_BYTES + 1) } },
      }),
      createCompletedRunFixture({
        publishedFiles: { shared: { "solver.py": 'print("synthetic grading fixture")\n' } },
      }),
    ]);

    const [absentMainBundle, missingBundle, oversizedBundle, outcomeBundle] = await Promise.all([
      compileEvidence({ root: absentMain.root, runRoot: absentMain.runRoot }),
      compileEvidence({ root: missing.root, runRoot: missing.runRoot }),
      compileEvidence({ root: oversized.root, runRoot: oversized.runRoot }),
      compileEvidence({ root: outcome.root, runRoot: outcome.runRoot }),
    ]);

    expect(absentMainBundle.bundle.items.some(({ kind }) => kind === "git.solver-snapshot")).toBe(
      false,
    );
    expect(absentMainBundle.bundle.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/main commit is unavailable/) }),
      ]),
    );
    expect(missingBundle.bundle.items.some(({ kind }) => kind === "git.solver-snapshot")).toBe(
      false,
    );
    expect(missingBundle.bundle.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/unavailable/) }),
      ]),
    );
    expect(oversizedBundle.bundle.items.some(({ kind }) => kind === "git.solver-snapshot")).toBe(
      false,
    );
    expect(oversizedBundle.bundle.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/exceeded/) }),
      ]),
    );
    const redacted = outcomeBundle.bundle.items.find(({ kind }) => kind === "git.solver-snapshot")!;
    expect(redacted).toMatchObject({
      content: "[redacted-outcome-content]",
      availability: "metadata-only",
      omissionReason: expect.stringMatching(/outcome-bearing/),
    });
    expect(outcomeBundle.bundle.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/outcome content/) }),
      ]),
    );
  });

  it("rejects a fixture package whose frozen bytes no longer match the RunRecord digest", async () => {
    const fixture = await createCompletedRunFixture();
    await writeFile(join(fixture.fixtureRoot, "complete", "ciphertext.txt"), "tampered\n", "utf8");

    await expect(compileEvidence({ root: fixture.root, runRoot: fixture.runRoot })).rejects.toThrow(
      /fixture package|contentDigest|declared digest/i,
    );
  });

  it("redacts adversarial free-form outcome narration and copied frozen plaintext", async () => {
    const fixture = await createCompletedRunFixture({
      observations: [
        {
          kind: "model.response",
          agentId: "agent-1",
          atMs: 1,
          data: { text: "checker accuracy is 0.75" },
        },
        {
          kind: "team.message",
          agentId: "agent-2",
          atMs: 2,
          data: { message: "we solved it" },
        },
        {
          kind: "tool.result",
          agentId: "agent-1",
          atMs: 3,
          data: { text: "synthetic grading fixture" },
        },
        {
          kind: "model.response",
          agentId: "agent-2",
          atMs: 4,
          data: { text: "the run succeeded" },
        },
        {
          kind: "model.response",
          agentId: "agent-1",
          atMs: 5,
          data: { text: "we got 75 percent" },
        },
        {
          kind: "tool.result",
          agentId: "agent-2",
          atMs: 6,
          data: { text: "checker passed" },
        },
        {
          kind: "team.message",
          agentId: "agent-1",
          atMs: 7,
          data: { message: "final output was correct" },
        },
        {
          kind: "model.response",
          agentId: "agent-2",
          atMs: 8,
          data: {
            reasoningSummary:
              "The earlier score was higher; perhaps matched words include unchanged words.",
          },
        },
      ],
    });

    const { bundle } = await compileEvidence({ root: fixture.root, runRoot: fixture.runRoot });
    const encoded = JSON.stringify(bundle);
    expect(encoded).not.toContain("accuracy is 0.75");
    expect(encoded).not.toContain("we solved it");
    expect(encoded).not.toContain("synthetic grading fixture");
    expect(encoded).not.toContain("the run succeeded");
    expect(encoded).not.toContain("we got 75 percent");
    expect(encoded).not.toContain("checker passed");
    expect(encoded).not.toContain("final output was correct");
    expect(encoded).not.toContain("earlier score was higher");
    expect(encoded).not.toContain("matched words include unchanged words");
    expect(
      bundle.items.filter(({ content }) =>
        JSON.stringify(content).includes("[redacted-outcome-content]"),
      ),
    ).toHaveLength(8);
    expect(bundle.omissions.filter(({ reason }) => reason.includes("free-form text"))).toHaveLength(
      8,
    );
  });
});
