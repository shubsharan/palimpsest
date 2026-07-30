import { describe, expect, it } from "vitest";

import { ATTEMPT_CUTOFF_MS, CONDITION_IDS, RELEASE_OFFSETS_MS } from "./condition.js";
import {
  buildAgentPrompt,
  buildAgentPromptTemplate,
  snapshotAgentPromptTemplates,
  TOKEN_BUDGET_PLACEHOLDER,
} from "./prompt.js";

const SHARED_CHANNEL =
  "Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Collaborate through the team's shared Git repository: publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it. Git does not count against your model-token budget.";
const ISOLATED_CHANNEL =
  "Peer communication is unavailable. Your assigned origin is private and no peer can see its commits or score. Publish your strongest solver to origin/main:solver.py so it remains part of the team record. Git does not count against your model-token budget.";

describe("agent prompt", () => {
  const prompts = Object.fromEntries(
    CONDITION_IDS.map((condition) => [
      condition,
      buildAgentPrompt({
        agentId: "agent-2",
        condition,
        tokenBudgetPerAgent: 200_000,
      }),
    ]),
  ) as Record<(typeof CONDITION_IDS)[number], string>;

  it("keeps prompts byte-identical across key regimes", () => {
    expect(prompts.CS).toBe(prompts.CR);
    expect(prompts.IS).toBe(prompts.IR);
    expect(prompts.CS).toMatchInlineSnapshot(`
      "You are Agent 2, one of 3 agents working concurrently as one team. Each agent receives different private evidence.

      Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Collaborate through the team's shared Git repository: publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it. Git does not count against your model-token budget.

      Recover the plaintext of the complete word-substitution cipher as accurately as you can.
      A runnable solver.py scaffold is already committed. Only origin/main:solver.py can be checked or graded; final prose, uncommitted files, other branches, and unpushed commits do not count.
      The checker and final grader run python3 solver.py from a clean checkout. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without /evidence or /reference.

      Additional private evidence may appear during the attempt. The attempt ends at 60 minutes.
      Your cumulative model-token limit is 200000.

      You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check the pushed origin/main:solver.py against your currently visible private evidence with check_published_solver, use Git, or wait for visible activity. The checker reports the exact commit and aggregate metrics; it covers only your visible evidence, so a perfect score does not prove the complete ciphertext is solved.
      Keep improving and pushing solver.py until you have verified that it produces a complete plaintext you believe solves the full ciphertext.
      Do not return a final response before then. If progress stalls, revisit assumptions, test a different approach, and use new evidence or Git activity to improve the solver. Wait only when no useful work remains, then resume when activity appears.

      Workspace: /workspace
      Private evidence: /evidence
      Reference corpus: /reference"
    `);
    expect(prompts.IS).toMatchInlineSnapshot(`
      "You are Agent 2, one of 3 agents working concurrently as one team. Each agent receives different private evidence.

      Peer communication is unavailable. Your assigned origin is private and no peer can see its commits or score. Publish your strongest solver to origin/main:solver.py so it remains part of the team record. Git does not count against your model-token budget.

      Recover the plaintext of the complete word-substitution cipher as accurately as you can.
      A runnable solver.py scaffold is already committed. Only origin/main:solver.py can be checked or graded; final prose, uncommitted files, other branches, and unpushed commits do not count.
      The checker and final grader run python3 solver.py from a clean checkout. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without /evidence or /reference.

      Additional private evidence may appear during the attempt. The attempt ends at 60 minutes.
      Your cumulative model-token limit is 200000.

      You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check the pushed origin/main:solver.py against your currently visible private evidence with check_published_solver, use Git, or wait for visible activity. The checker reports the exact commit and aggregate metrics; it covers only your visible evidence, so a perfect score does not prove the complete ciphertext is solved.
      Keep improving and pushing solver.py until you have verified that it produces a complete plaintext you believe solves the full ciphertext.
      Do not return a final response before then. If progress stalls, revisit assumptions, test a different approach, and use new evidence or Git activity to improve the solver. Wait only when no useful work remains, then resume when activity appears.

      Workspace: /workspace
      Private evidence: /evidence
      Reference corpus: /reference"
    `);
  });

  it("exposes canonical token-placeholder templates for the design receipt", () => {
    const templates = snapshotAgentPromptTemplates();
    const agentIds = ["agent-1", "agent-2", "agent-3"] as const;

    expect(Object.keys(templates)).toEqual(agentIds);
    for (const agentId of agentIds) {
      const conditionTemplates = templates[agentId];
      expect(Object.keys(conditionTemplates)).toEqual(CONDITION_IDS);
      expect(conditionTemplates.CS).toBe(conditionTemplates.CR);
      expect(conditionTemplates.IS).toBe(conditionTemplates.IR);
      expect(conditionTemplates.CS.replace(SHARED_CHANNEL, "<channel>")).toBe(
        conditionTemplates.IS.replace(ISOLATED_CHANNEL, "<channel>"),
      );
      for (const condition of CONDITION_IDS) {
        const template = conditionTemplates[condition];
        expect(template).toContain(
          `You are Agent ${agentId.slice("agent-".length)}, one of 3 agents`,
        );
        expect(template.split(TOKEN_BUDGET_PLACEHOLDER)).toHaveLength(2);
        expect(template).not.toContain("200000");
        expect(template.replace(TOKEN_BUDGET_PLACEHOLDER, "200000")).toBe(
          buildAgentPrompt({
            agentId,
            condition,
            tokenBudgetPerAgent: 200_000,
          }),
        );
      }
    }

    expect(templates["agent-2"].CS).toMatchInlineSnapshot(`
      "You are Agent 2, one of 3 agents working concurrently as one team. Each agent receives different private evidence.

      Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Collaborate through the team's shared Git repository: publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it. Git does not count against your model-token budget.

      Recover the plaintext of the complete word-substitution cipher as accurately as you can.
      A runnable solver.py scaffold is already committed. Only origin/main:solver.py can be checked or graded; final prose, uncommitted files, other branches, and unpushed commits do not count.
      The checker and final grader run python3 solver.py from a clean checkout. It must read $PALIMPSEST_CIPHERTEXT, write the complete plaintext to $PALIMPSEST_OUTPUT, and work without /evidence or /reference.

      Additional private evidence may appear during the attempt. The attempt ends at 60 minutes.
      Your cumulative model-token limit is {{tokenBudgetPerAgent}}.

      You can inspect your private evidence, use the target-excluded reference corpus, run local commands, check the pushed origin/main:solver.py against your currently visible private evidence with check_published_solver, use Git, or wait for visible activity. The checker reports the exact commit and aggregate metrics; it covers only your visible evidence, so a perfect score does not prove the complete ciphertext is solved.
      Keep improving and pushing solver.py until you have verified that it produces a complete plaintext you believe solves the full ciphertext.
      Do not return a final response before then. If progress stalls, revisit assumptions, test a different approach, and use new evidence or Git activity to improve the solver. Wait only when no useful work remains, then resume when activity appears.

      Workspace: /workspace
      Private evidence: /evidence
      Reference corpus: /reference"
    `);
  });

  it("builds any one template from the same canonical bytes", () => {
    const templates = snapshotAgentPromptTemplates();

    for (const agentId of ["agent-1", "agent-2", "agent-3"] as const) {
      for (const condition of CONDITION_IDS) {
        expect(buildAgentPromptTemplate({ agentId, condition })).toBe(
          templates[agentId][condition],
        );
      }
    }
  });

  it("varies only the communication-channel paragraph", () => {
    expect(prompts.CS).toContain(SHARED_CHANNEL);
    expect(prompts.IS).toContain(ISOLATED_CHANNEL);
    expect(prompts.CS.replace(SHARED_CHANNEL, "<channel>")).toBe(
      prompts.IS.replace(ISOLATED_CHANNEL, "<channel>"),
    );
  });

  it("discloses the invariant identity, objective, schedule, limits, tools, and evaluation boundary", () => {
    const prompt = prompts.CR;

    expect(prompt).toContain(
      "You are Agent 2, one of 3 agents working concurrently as one team. Each agent receives different private evidence.",
    );
    expect(prompt).toContain(
      "Recover the plaintext of the complete word-substitution cipher as accurately as you can.",
    );
    expect(prompt).toContain("Additional private evidence may appear during the attempt.");
    expect(prompt).not.toContain("0, 5, 10, 20, 30, and 40 minutes");
    expect(prompt).toContain("The attempt ends at 60 minutes.");
    expect(prompt).toContain("Your cumulative model-token limit is 200000.");
    expect(prompt).toContain("check_published_solver");
    expect(prompt).toContain("aggregate metrics");
    expect(prompt).toContain("wait for visible activity");
    expect(prompt).toContain("Only origin/main:solver.py can be checked or graded");
    expect(prompt).toContain(
      "final prose, uncommitted files, other branches, and unpushed commits do not count.",
    );
    expect(prompt).toContain("run python3 solver.py from a clean checkout");
    expect(prompt).not.toContain("frozen workspace");
    expect(prompt).toContain("$PALIMPSEST_CIPHERTEXT");
    expect(prompt).toContain("$PALIMPSEST_OUTPUT");
    expect(prompt).toContain("work without /evidence or /reference");
    expect(prompt).toContain(
      "The checker reports the exact commit and aggregate metrics; it covers only your visible evidence, so a perfect score does not prove the complete ciphertext is solved.",
    );
    expect(prompt).toContain(
      "Keep improving and pushing solver.py until you have verified that it produces a complete plaintext you believe solves the full ciphertext.",
    );
    expect(prompt).toContain(
      "Do not return a final response before then. If progress stalls, revisit assumptions, test a different approach, and use new evidence or Git activity to improve the solver. Wait only when no useful work remains, then resume when activity appears.",
    );
    expect(prompt).not.toContain("Return a final response when you are done.");
    expect(prompt).toContain("Workspace: /workspace");
    expect(prompt).toContain("Private evidence: /evidence");
    expect(prompt).toContain("Reference corpus: /reference");
    expect(prompt).not.toContain("/private/agent-2");
    expect(RELEASE_OFFSETS_MS).toHaveLength(6);
    expect(ATTEMPT_CUTOFF_MS).toBe(60 * 60 * 1_000);
  });

  it.each(CONDITION_IDS)(
    "contains no hidden-treatment or fixed-workflow language in %s",
    (condition) => {
      const prompt = prompts[condition];

      expect(prompt).not.toMatch(
        /re-?key|stationary|changed mapping|transition stage|anchor|sentinel|specialist|control set|allocation/i,
      );
      expect(prompt).not.toMatch(
        /assigned role|choose your own role|best solver|collaboration cadence|required (?:branch|checkpoint)|take turns|commit sequence/i,
      );
    },
  );
});
