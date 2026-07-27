import { FrameValidationError } from "./binary.js";
import { GIT_SHA256_OID_BYTES, refOperations, type RefOperationCode } from "./types.js";

export const MAX_REF_NAME_BYTES = 200;
export const MAX_OBJECT_COUNT = 100_000;
export const MAX_OBJECT_CONTENT_BYTES = 64 * 1024 * 1024;
export const MAX_FRAME_BYTES = 256 * 1024 * 1024;

const agentRef =
  /^refs\/heads\/agents\/[a-z0-9](?:[a-z0-9-]{0,31})\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/;

export function isZeroOid(oid: Buffer): boolean {
  return oid.length === GIT_SHA256_OID_BYTES && oid.every((byte) => byte === 0);
}

export function validateOid(oid: Buffer, label: string): void {
  if (oid.length !== GIT_SHA256_OID_BYTES) {
    throw new FrameValidationError("oid", `${label} must be a 32-byte Git SHA-256 OID.`);
  }
}

export function validateRefName(refName: string): Buffer {
  const bytes = Buffer.from(refName, "utf8");
  if (
    bytes.toString("utf8") !== refName ||
    bytes.some((byte) => byte > 0x7f) ||
    bytes.length === 0 ||
    bytes.length > MAX_REF_NAME_BYTES ||
    (refName !== "refs/heads/main" && !agentRef.test(refName)) ||
    refName.includes("..") ||
    refName.includes("//") ||
    refName.includes("@{") ||
    refName.endsWith(".lock") ||
    refName.endsWith(".") ||
    refName.endsWith("/")
  ) {
    throw new FrameValidationError("ref_name", `Rejected accounting ref name: ${refName}.`);
  }
  return bytes;
}

export function validateRefTransition(
  operation: RefOperationCode,
  oldOid: Buffer,
  newOid: Buffer,
): void {
  validateOid(oldOid, "oldOid");
  validateOid(newOid, "newOid");
  if (isZeroOid(newOid)) {
    throw new FrameValidationError("ref_transition", "Ref deletion is forbidden.");
  }
  if (operation === refOperations.create) {
    if (!isZeroOid(oldOid)) {
      throw new FrameValidationError("ref_transition", "A ref create requires a zero old OID.");
    }
    return;
  }
  if (operation === refOperations.update) {
    if (isZeroOid(oldOid) || oldOid.equals(newOid)) {
      throw new FrameValidationError(
        "ref_transition",
        "A ref update requires distinct nonzero old and new OIDs.",
      );
    }
    return;
  }
  throw new FrameValidationError("ref_operation", `Unsupported ref operation: ${operation}.`);
}
