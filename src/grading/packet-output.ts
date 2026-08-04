import type { JsonObject } from "../model/contracts.js";

function strictObjectSchema(
  properties: Readonly<Record<string, JsonObject>>,
  required: readonly string[] = Object.keys(properties),
): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function citationIdsSchema(): JsonObject {
  return {
    type: "array",
    items: { type: "string", pattern: "^c[0-9]{3}$" },
  };
}

function dimensionOutputSchema(): JsonObject {
  return strictObjectSchema({
    dimensionId: { type: "string" },
    assessment: {
      type: "string",
      enum: [
        "rated-0",
        "rated-1",
        "rated-2",
        "rated-3",
        "rated-4",
        "unobservable",
        "not-applicable",
      ],
    },
    claimIds: { type: "array", items: { type: "string", pattern: "^claim-[0-9]{3}$" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  });
}

function structuredClaimSchema(): JsonObject {
  return strictObjectSchema({
    claimId: { type: "string", pattern: "^claim-[0-9]{3}$" },
    opportunityId: { type: "string", pattern: "^opp-[0-9]{4}$" },
    subjectScope: {
      type: "string",
      enum: ["evaluation-unit", "actor", "cross-actor", "canonical-artifact", "infrastructure"],
    },
    actorIds: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
    },
    predicate: {
      type: "string",
      enum: [
        "commitment",
        "alternative",
        "test",
        "counterevidence",
        "revision",
        "transmission",
        "uptake",
        "verification",
        "integration",
        "duplication",
        "conflict",
        "repair",
        "tool-use",
        "validation",
        "publication",
        "failure",
        "recovery",
      ],
    },
    state: { type: "string", enum: ["observed", "contradicted", "unobservable", "not-applicable"] },
    qualification: { type: "string", enum: ["direct", "partial", "ambiguous", "missing"] },
    evidenceIds: citationIdsSchema(),
    counterevidenceIds: citationIdsSchema(),
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    missingReason: { type: "string" },
  });
}

function episodeOutputSchema(): JsonObject {
  return strictObjectSchema({
    episodeId: { type: "string" },
    status: {
      type: "string",
      enum: ["supported-revision", "asserted-only", "missed-revision", "unchanged", "ambiguous"],
    },
    evidenceIds: citationIdsSchema(),
    commitmentIds: citationIdsSchema(),
    testIds: citationIdsSchema(),
    revisionIds: citationIdsSchema(),
    transmissionIds: citationIdsSchema(),
    uptakeIds: citationIdsSchema(),
    integrationIds: citationIdsSchema(),
    counterevidenceIds: citationIdsSchema(),
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  });
}

export function packetReviewerOutputSchema(): JsonObject {
  return strictObjectSchema({
    schemaVersion: { type: "integer", const: 1 },
    claims: { type: "array", items: structuredClaimSchema() },
    dimensions: { type: "array", items: dimensionOutputSchema() },
    episodes: { type: "array", items: episodeOutputSchema() },
    cautions: { type: "array", items: { type: "string" } },
  });
}
