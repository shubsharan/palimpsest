import { predeclarationDigest, predeclarationProjection } from "./gate-report-core.js";
import { validateValue, type ValidationVerdict } from "./validation.js";

export interface GateCompletion {
  analysis: unknown;
  environment: unknown;
  followUp: unknown;
  producerVersions: unknown;
  rawArtifacts: unknown;
  result: unknown;
}

export function validateGateReport(report: Record<string, unknown>): ValidationVerdict {
  return validateValue("gate-report", report);
}

export function completeGateReport(
  predeclared: Record<string, unknown>,
  completion: GateCompletion,
): Record<string, unknown> {
  const verdict = validateGateReport(predeclared);
  if (!verdict.accepted || predeclared.state !== "predeclared") {
    throw new Error("Only a valid predeclared gate report can be completed.");
  }
  return {
    ...completion,
    ...predeclarationProjection(predeclared),
    state: "completed",
    predeclarationDigest: predeclarationDigest(predeclared),
  };
}

export { predeclarationDigest, predeclarationProjection };
