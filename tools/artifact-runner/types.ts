export type FailureMode =
  | "honest"
  | "network-probe"
  | "timeout"
  | "producer-failure"
  | "malformed-progress"
  | "truncated-progress"
  | "missing-output"
  | "undeclared-output"
  | "digest-mismatch"
  | "length-mismatch"
  | "disallowed-producer-version";

export type AttemptFailureCode =
  | "deadline_exceeded"
  | "producer_exit"
  | "malformed_progress"
  | "truncated_progress"
  | "missing_output"
  | "undeclared_output"
  | "digest_mismatch"
  | "length_mismatch"
  | "producer_version"
  | "unsafe_output"
  | "promotion_io"
  | "unsupported_environment";

export interface ArtifactReference {
  artifactType: string;
  byteLength: number;
  sha256: string;
}

export interface EvidenceEnvironment {
  git: "2.48.1";
  node: "26.5.0";
  platform: string;
  pnpm: "10.14.0";
  python: "3.12.4";
  revision: string;
  uv: "0.11.14";
}

export interface ReferenceRequest {
  deadlineMs: number;
  environment: EvidenceEnvironment;
  immutableInputs: ArtifactReference[];
  payload: {
    message: string;
  };
  producer: {
    allowedVersions: string[];
    name: "reference-producer";
  };
  requestId: string;
  schemaVersion: 1;
}

export interface OutputManifestEntry {
  byteLength: number;
  path: string;
  sha256: string;
}

export interface ArtifactResponseManifest {
  archive: {
    byteLength: number;
    sha256: string;
  };
  environment: EvidenceEnvironment;
  immutableInputs: ArtifactReference[];
  outputs: OutputManifestEntry[];
  producer: {
    name: string;
    version: string;
  };
  requestDigest: string;
  schemaVersion: 1;
}

export interface ProgressRecord {
  kind: "started" | "completed";
  requestDigest: string;
  responseManifest?: ArtifactResponseManifest;
  schemaVersion: 1;
  sequence: number;
}

export interface PromotionResult {
  artifactDigest: string;
  artifactPath: string;
  attemptId: string;
  manifest: ArtifactResponseManifest;
  requestDigest: string;
}

export interface RunReferenceProducerOptions {
  mode: FailureMode;
  request: ReferenceRequest;
  storeRoot: string;
}

export class ArtifactRunError extends Error {
  readonly code: AttemptFailureCode;
  readonly diagnostics: string | undefined;

  constructor(code: AttemptFailureCode, message: string, diagnostics?: string) {
    super(message);
    this.name = "ArtifactRunError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
