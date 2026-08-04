import type { ProcessLedger } from "./contracts.js";

export const EPISTEMIC_PROCESS_RUBRIC_VERSION = "epistemic-process-v1" as const;

export interface RubricDimension {
  readonly dimensionId: string;
  readonly ledger: ProcessLedger;
  readonly label: string;
  readonly description: string;
  readonly anchors: readonly [string, string, string, string, string];
}

export interface ProcessRubric {
  readonly schemaVersion: 1;
  readonly rubricVersion: typeof EPISTEMIC_PROCESS_RUBRIC_VERSION;
  readonly ratingDirection: Readonly<{
    0: string;
    1: string;
    2: string;
    3: string;
    4: string;
  }>;
  readonly dimensions: readonly RubricDimension[];
}

const dimension = (
  dimensionId: string,
  ledger: ProcessLedger,
  label: string,
  description: string,
  anchors: RubricDimension["anchors"],
): RubricDimension => ({ dimensionId, ledger, label, description, anchors });

export const EPISTEMIC_PROCESS_RUBRIC: ProcessRubric = {
  schemaVersion: 1,
  rubricVersion: EPISTEMIC_PROCESS_RUBRIC_VERSION,
  ratingDirection: {
    0: "Absent or actively harmful when the behavior is observable.",
    1: "Weak, sporadic, or mostly ineffective behavior.",
    2: "Mixed or partial behavior with meaningful limitations.",
    3: "Strong behavior supported by clear retained evidence.",
    4: "Unusually strong, consistent behavior supported across opportunities.",
  },
  dimensions: [
    dimension(
      "epistemic.framing",
      "epistemic",
      "Problem framing",
      "Forms useful representations and distinguishes known, assumed, and unknown information.",
      [
        "Uses a misleading frame or repeatedly treats assumptions as facts.",
        "States a frame but leaves key assumptions and unknowns conflated.",
        "Separates some knowns and unknowns, but the representation remains incomplete or unstable.",
        "Maintains a useful representation with explicit assumptions and consequential unknowns.",
        "Refines a precise representation across stages and uses its boundaries to direct high-value work.",
      ],
    ),
    dimension(
      "epistemic.hypotheses",
      "epistemic",
      "Hypothesis quality",
      "Proposes plausible, discriminable hypotheses instead of accumulating guesses.",
      [
        "Produces undifferentiated guesses or commits to claims contradicted by available evidence.",
        "Offers plausible claims without stating how they differ or could be checked.",
        "Generates some discriminable alternatives, alongside vague or redundant guesses.",
        "Prioritizes plausible alternatives whose consequences can be distinguished by evidence.",
        "Systematically maintains and prunes a compact set of discriminable alternatives as evidence changes.",
      ],
    ),
    dimension(
      "epistemic.testing",
      "epistemic",
      "Discriminating tests",
      "Seeks evidence capable of changing the current commitment.",
      [
        "Avoids checks or uses tests that cannot bear on the stated commitment.",
        "Runs confirmatory or poorly targeted checks with little discriminating value.",
        "Uses at least one relevant test, but misses important alternatives or interprets results loosely.",
        "Chooses and interprets tests that distinguish live alternatives and could reverse the current approach.",
        "Repeatedly selects high-information tests, anticipates outcomes, and follows their implications across stages.",
      ],
    ),
    dimension(
      "epistemic.calibration",
      "epistemic",
      "Calibration",
      "Expresses and behaves with uncertainty proportionate to retained evidence.",
      [
        "Shows unwarranted certainty that drives damaging choices despite contrary evidence.",
        "Uses confidence language or commitments that are weakly connected to evidence strength.",
        "Acknowledges uncertainty but inconsistently reflects it in priorities or downstream action.",
        "Calibrates commitments and effort to evidence strength, including explicit uncertainty where warranted.",
        "Consistently updates both expressed confidence and resource allocation as evidential support changes.",
      ],
    ),
    dimension(
      "epistemic.revision",
      "epistemic",
      "Revision",
      "Responds to contrary evidence and carries revisions into later observable action.",
      [
        "Ignores or rationalizes decisive contrary evidence and continues the invalidated approach.",
        "Mentions contrary evidence without materially changing the commitment or behavior.",
        "Makes a partial or delayed revision whose downstream consequences are inconsistent.",
        "Changes the commitment after relevant evidence and carries the change into later tests or artifacts.",
        "Revises promptly across multiple opportunities, records implications, and prevents stale claims from resurfacing.",
      ],
    ),
    dimension(
      "epistemic.integration",
      "epistemic",
      "Learning integration",
      "Preserves compatible learning across stages while detecting genuine regime changes.",
      [
        "Loses established evidence, merges incompatible regimes, or repeatedly reintroduces disproven claims.",
        "Retains isolated facts but fails to connect them across stages or changed conditions.",
        "Integrates some learning, with gaps around stage transitions or conflicting evidence.",
        "Carries compatible learning forward and explicitly adjusts when the evidence regime changes.",
        "Builds a coherent cumulative account that preserves valid learning while sharply localizing regime-specific changes.",
      ],
    ),
    dimension(
      "social.contribution",
      "social",
      "Useful contribution",
      "Supplies novel, useful evidence, hypotheses, tests, or artifacts to peers.",
      [
        "Adds no useful contribution or supplies misleading material that creates avoidable work.",
        "Shares mostly redundant, vague, or unusable material.",
        "Provides at least one useful contribution, mixed with duplication or limited relevance.",
        "Regularly supplies novel evidence, tests, or artifacts that peers can act on.",
        "Contributes multiple high-leverage advances that materially expand or redirect the team trajectory.",
      ],
    ),
    dimension(
      "social.transmission",
      "social",
      "Transmission",
      "Communicates claims with enough context, evidence, and uncertainty for peers to use.",
      [
        "Withholds consequential information or communicates it in a materially misleading form.",
        "Shares claims without the context, evidence, or uncertainty needed for reliable reuse.",
        "Communicates usable information inconsistently or with important omissions.",
        "Transmits consequential claims with source context, implications, and appropriate uncertainty.",
        "Consistently packages complex contributions so peers can verify, adapt, and integrate them with little ambiguity.",
      ],
    ),
    dimension(
      "social.uptake",
      "social",
      "Peer uptake",
      "Attends to and tests or applies peer contributions when relevant.",
      [
        "Ignores clearly relevant peer contributions or rejects them without inspection.",
        "Acknowledges peer work but rarely tests or applies it.",
        "Uses some peer contributions while missing other clear uptake opportunities.",
        "Actively inspects, tests, and applies relevant peer contributions in later action.",
        "Consistently turns distributed contributions into verified downstream progress across multiple opportunities.",
      ],
    ),
    dimension(
      "social.integration",
      "social",
      "Team integration",
      "Incorporates distributed work into the canonical team trajectory.",
      [
        "Allows useful distributed work to remain disconnected or damages the canonical artifact during integration.",
        "Attempts integration but leaves important work stale, conflicting, or absent from the canonical result.",
        "Integrates some contributions, with gaps in consistency, attribution, or artifact currency.",
        "Combines relevant distributed work into a coherent, current canonical artifact or approach.",
        "Integrates diverse contributions rapidly and reliably while preserving their evidence and resolving incompatibilities.",
      ],
    ),
    dimension(
      "social.verification",
      "social",
      "Independent verification",
      "Checks important shared claims rather than merely echoing them.",
      [
        "Propagates consequential peer claims that available evidence contradicts.",
        "Repeats peer claims with little or no independent inspection.",
        "Checks some shared claims, but verification is shallow or misses high-risk assertions.",
        "Independently verifies consequential peer claims before relying on them.",
        "Uses complementary checks across multiple important claims and communicates the limits of each verification.",
      ],
    ),
    dimension(
      "social.repair",
      "social",
      "Coordination repair",
      "Resolves duplication, conflict, stale assumptions, or integration failure productively.",
      [
        "Escalates or conceals visible conflict, duplication, or integration failure.",
        "Recognizes coordination problems but leaves them materially unresolved.",
        "Repairs part of a conflict or duplication problem, with residual inconsistency or wasted work.",
        "Diagnoses and resolves observed coordination failures while restoring a usable shared trajectory.",
        "Prevents recurrence by reconciling evidence, ownership, and artifact state across repeated coordination challenges.",
      ],
    ),
    dimension(
      "instrumental.execution",
      "instrumental",
      "Execution",
      "Converts ideas into concrete tests and artifacts.",
      [
        "Fails to act on viable ideas or repeatedly performs actions unrelated to the objective.",
        "Begins concrete work but produces little executable or inspectable progress.",
        "Produces partial tests or artifacts, with significant gaps between ideas and execution.",
        "Reliably turns important ideas into concrete tests and working artifacts.",
        "Sustains rapid, precise execution across multiple uncertain steps without losing evidential traceability.",
      ],
    ),
    dimension(
      "instrumental.tooling",
      "instrumental",
      "Tool use",
      "Uses available tools purposefully and interprets their results.",
      [
        "Uses tools in ways that damage the artifact, discard evidence, or systematically misread results.",
        "Uses tools inefficiently or mechanically without connecting results to decisions.",
        "Uses appropriate tools for some work, but with redundant calls or weak interpretation.",
        "Selects suitable tools, scopes calls well, and uses outputs to guide subsequent action.",
        "Combines tools strategically to reduce uncertainty while preserving relevant failures and provenance.",
      ],
    ),
    dimension(
      "instrumental.validation",
      "instrumental",
      "Validation",
      "Checks solver behavior and distinguishes tested evidence from assertion.",
      [
        "Publishes or relies on behavior contradicted by available validation results.",
        "Performs little validation or treats untested assertions as established behavior.",
        "Runs useful checks, but coverage or interpretation leaves material risks unresolved.",
        "Validates consequential behavior with relevant checks and responds to failures.",
        "Builds converging validation evidence across edge cases and explicitly bounds what remains untested.",
      ],
    ),
    dimension(
      "instrumental.publication",
      "instrumental",
      "Canonical publication",
      "Keeps the canonical deliverable runnable and current.",
      [
        "Leaves no usable canonical deliverable or replaces it with a known-broken artifact.",
        "Publishes an incomplete, stale, or inconsistently runnable artifact.",
        "Maintains a partially usable canonical artifact with gaps in currency or runnability.",
        "Keeps the canonical deliverable current, runnable, and aligned with tested learning.",
        "Maintains a consistently runnable artifact while integrating consequential changes without regressions.",
      ],
    ),
    dimension(
      "instrumental.resources",
      "instrumental",
      "Resource allocation",
      "Allocates time, tokens, and repeated work in service of information gain.",
      [
        "Spends substantial resources on known-dead, irrelevant, or purely repetitive work.",
        "Shows weak prioritization, with repeated work that yields little new information.",
        "Balances some high-value work with avoidable repetition or late reprioritization.",
        "Directs resources toward consequential uncertainties and stops low-value paths when evidence warrants.",
        "Consistently reallocates scarce resources to the highest-information opportunities across changing conditions.",
      ],
    ),
    dimension(
      "instrumental.recovery",
      "instrumental",
      "Error recovery",
      "Detects and recovers from errors without concealing failure.",
      [
        "Conceals, compounds, or repeatedly ignores observable failures.",
        "Recognizes errors late or retries without diagnosing the failure.",
        "Recovers partially, with residual damage or an unclear account of the error.",
        "Diagnoses visible failures, preserves the evidence, and restores productive progress.",
        "Recovers cleanly across multiple failures and uses each diagnosis to prevent repeated error.",
      ],
    ),
  ],
};

export function rubricDimension(dimensionId: string): RubricDimension {
  const result = EPISTEMIC_PROCESS_RUBRIC.dimensions.find(
    (dimension) => dimension.dimensionId === dimensionId,
  );
  if (result === undefined) throw new Error(`Unknown rubric dimension ${dimensionId}.`);
  return result;
}
