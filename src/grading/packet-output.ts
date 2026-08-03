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
    rationale: { type: "string" },
    counterevidenceIds: citationIdsSchema(),
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    evidenceIds: citationIdsSchema(),
  });
}

function episodeOutputSchema(): JsonObject {
  return strictObjectSchema({
    episodeId: { type: "string" },
    summary: { type: "string" },
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
    dimensions: { type: "array", items: dimensionOutputSchema() },
    episodes: { type: "array", items: episodeOutputSchema() },
    cautions: { type: "array", items: { type: "string" } },
  });
}
