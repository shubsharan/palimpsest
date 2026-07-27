import { join } from "node:path";

export const HARNESS_ROOT = "artifacts/harness";
export const FIXTURE_ADAPTER_ID = "fixture-agent-v1";
export const HARNESS_PRODUCER_VERSION = "0.1.0";
export const HARNESS_SCHEMA_VERSION = 1;
export const AGENT_IDS = ["agent-1", "agent-2", "agent-3"] as const;
export const RETAINED_COMMUNICATION_BUDGET_BYTES = 38_912;
export const CONTAINER_BASE_IMAGE =
  "node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb";
export const FIXTURE_IMAGE_TAG = "palimpsest-fixture-agent:0.1.0";
export const GIT_GATEWAY_IMAGE_TAG = "palimpsest-git-gateway:0.1.0";
export const CLEAN_SOLVER_IMAGE_TAG = "palimpsest-clean-solver:0.1.0";

export interface HarnessAttemptIdentity {
  declarationDigest: string;
  runId: string;
}

export interface OfflineHarnessAuthorization {
  schemaVersion: 1;
  contractId: "offline-harness-report";
  declarationDigest: string;
  runId: string;
  reportDigest: string;
  result: "pass";
  liveModelValidationAuthorized: true;
  allowedAdapterIds: string[];
}

function requireDigest(name: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  }
}

function requireRunId(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("Run ID must be a safe lowercase artifact identifier.");
  }
}

export function attemptPath(root: string, identity: HarnessAttemptIdentity): string {
  requireDigest("Declaration digest", identity.declarationDigest);
  requireRunId(identity.runId);
  return join(root, "attempts", identity.declarationDigest, identity.runId);
}

export function assertAdapterAuthorized(
  adapterId: string,
  authorization?: OfflineHarnessAuthorization,
): void {
  if (adapterId === FIXTURE_ADAPTER_ID) {
    return;
  }
  if (!authorization) {
    throw new Error(`Adapter ${adapterId} requires a passing offline harness completion report.`);
  }
  requireDigest("Authorization declaration digest", authorization.declarationDigest);
  requireDigest("Authorization report digest", authorization.reportDigest);
  if (
    authorization.result !== "pass" ||
    authorization.liveModelValidationAuthorized !== true ||
    !authorization.allowedAdapterIds.includes(adapterId)
  ) {
    throw new Error(`Adapter ${adapterId} is not authorized by the offline harness report.`);
  }
}
