import { canonicalJsonBytes } from "./canonical-json.js";
import { sha256Hex } from "./digest.js";

const declarationFields = [
  "schemaVersion",
  "gateId",
  "question",
  "frozenInputs",
  "thresholds",
  "criteria",
] as const;

export function predeclarationProjection(report: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    declarationFields.map((field) => {
      if (!(field in report)) {
        throw new Error(`Gate report is missing predeclaration field: ${field}`);
      }
      return [field, report[field]];
    }),
  );
}

export function predeclarationDigest(report: Record<string, unknown>): string {
  return sha256Hex(canonicalJsonBytes(predeclarationProjection(report)));
}
