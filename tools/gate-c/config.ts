export const GATE_C_PROFILE = "partial-rekey-literary-v1";
export const REVEAL_SLOT_COUNT = 6;
export const REVEAL_INTERVAL_MS = 120_000;
export const FRONTIER_MODEL = "gpt-5.6-sol";
export const FRONTIER_REASONING_EFFORT = "max";
export const FRONTIER_REASONING_SUMMARY = "detailed";
export const FRONTIER_MAX_OUTPUT_TOKENS = 64_000;
export const FRONTIER_RESPONSE_TIMEOUT_MS = 110_000;
export const REVEAL_EARLY_TOLERANCE_MS = 0;
export const REVEAL_LATE_TOLERANCE_MS = 1_000;

export interface GateCAttemptIdentity {
  declarationDigest: string;
  runId: string;
}

export interface MonotonicClock {
  nowMs(): number;
  waitUntil(targetMs: number): Promise<void>;
}
