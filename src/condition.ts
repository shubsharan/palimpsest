import { createHash } from "node:crypto";

export const CONDITION_IDS = Object.freeze(["CS", "CR", "IS", "IR"] as const);

export type ConditionId = (typeof CONDITION_IDS)[number];
export type CommunicationMode = "shared" | "isolated";
export type KeyRegime = "stationary" | "rekey";
export type BuildVariantId = KeyRegime;

export interface Condition {
  readonly id: ConditionId;
  readonly communicationMode: CommunicationMode;
  readonly keyRegime: KeyRegime;
  readonly variantId: BuildVariantId;
}

const CONDITIONS: Readonly<Record<ConditionId, Condition>> = Object.freeze({
  CS: Object.freeze({
    id: "CS",
    communicationMode: "shared",
    keyRegime: "stationary",
    variantId: "stationary",
  }),
  CR: Object.freeze({
    id: "CR",
    communicationMode: "shared",
    keyRegime: "rekey",
    variantId: "rekey",
  }),
  IS: Object.freeze({
    id: "IS",
    communicationMode: "isolated",
    keyRegime: "stationary",
    variantId: "stationary",
  }),
  IR: Object.freeze({
    id: "IR",
    communicationMode: "isolated",
    keyRegime: "rekey",
    variantId: "rekey",
  }),
});

export const RELEASE_OFFSETS_MS = Object.freeze([
  0, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000,
] as const);

export const ATTEMPT_CUTOFF_MS = 3_600_000;

export function resolveCondition(value: unknown): Condition {
  if (typeof value === "string" && Object.hasOwn(CONDITIONS, value)) {
    return CONDITIONS[value as ConditionId];
  }
  throw new Error("Condition must be exactly one of CS, CR, IS, or IR.");
}

function invalidProtocolSnapshot(): never {
  throw new Error("Protocol snapshot must contain only JSON-compatible values.");
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalidProtocolSnapshot();
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return invalidProtocolSnapshot();
  if (ancestors.has(value)) return invalidProtocolSnapshot();

  ancestors.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalidProtocolSnapshot();
    const record = value as Record<string, unknown>;
    result = `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
      .join(",")}}`;
  }
  ancestors.delete(value);
  return result;
}

export function hashProtocolSnapshot(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot, new Set())).digest("hex");
}
