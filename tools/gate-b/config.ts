export const gateBProfileId = "stationary-render-safe-v1";
export const gateBTargetTokenCount = 20_000;
export const gateBFrontierModel = "gpt-5.6-sol";
export const gateBFrontierReasoningEffort = "max";
export const gateBModelRevision = "fb53ab8802853c8e4fbdbcd0529f21fc6f459b2b";
export const gateBSpacyModel = "en_core_web_sm-3.8.0";

export const gateBInstances = [
  {
    diagnosticRole: "unrecognized-literary",
    entityReviewPath: "artifacts/gate-b/inputs/entity-review/instance-amber.json",
    instanceId: "instance-amber",
    sourceId: "middlemarch",
    sourcePath: "artifacts/gate-a/inputs/sources/middlemarch.txt",
    tier: "gutenberg",
    interiorChapterIndex: 20,
    seedHex: "41".repeat(32),
  },
  {
    diagnosticRole: "recognized-literary",
    entityReviewPath: "artifacts/gate-b/inputs/entity-review/instance-birch.json",
    instanceId: "instance-birch",
    sourceId: "moby-dick",
    sourcePath: "artifacts/gate-a/inputs/sources/moby-dick.txt",
    tier: "gutenberg",
    interiorChapterIndex: 35,
    seedHex: "42".repeat(32),
  },
  {
    diagnosticRole: "unrecognized-non-literary",
    entityReviewPath: "artifacts/gate-b/inputs/entity-review/instance-cobalt.json",
    instanceId: "instance-cobalt",
    sourceId: "farm-mechanics",
    sourcePath: "artifacts/gate-b/inputs/sources/farm-mechanics.txt",
    tier: "gutenberg",
    interiorChapterIndex: 3,
    seedHex: "43".repeat(32),
  },
] as const;

export const gateBDecisionThresholds = {
  capableFinalMinimumInclusive: 0.25,
  capableGainMinimumInclusive: 0.1,
  commonNounOverCaptureMaximumInclusive: 0.02,
  entityConsistencyMinimumInclusive: 0.99,
  entityMissedMaximumInclusive: 0.1,
  generatedNameCollisions: 0,
  mechanicalMaximumExclusive: 0.85,
  mechanicalUnresolvedMinimumInclusive: 0.15,
} as const;
