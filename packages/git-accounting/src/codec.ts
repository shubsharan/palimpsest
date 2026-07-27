import { BinaryReader, BinaryWriter, FrameValidationError } from "./binary.js";
import { gitObjectOid, gitObjectTypeName } from "./git-objects.js";
import {
  MAX_FRAME_BYTES,
  MAX_OBJECT_CONTENT_BYTES,
  MAX_OBJECT_COUNT,
  validateOid,
  validateRefName,
  validateRefTransition,
} from "./policy.js";
import {
  ACCOUNTING_MAGIC,
  ACCOUNTING_VERSION,
  GIT_SHA256_OBJECT_FORMAT,
  GIT_SHA256_OID_BYTES,
  type GitAccountingFrameV1,
  type GitObjectTypeCode,
  type LogicalGitObject,
  type RefOperationCode,
} from "./types.js";

const FIXED_PREFIX_BYTES = 8 + 8 + 2 + 2 + 2 + 4 + 1 + 2;
const FIXED_REF_SUFFIX_BYTES = GIT_SHA256_OID_BYTES * 2 + 4;
const OBJECT_PREFIX_BYTES = GIT_SHA256_OID_BYTES + 1 + 8;

function validateObjects(objects: LogicalGitObject[]): LogicalGitObject[] {
  if (objects.length > MAX_OBJECT_COUNT) {
    throw new FrameValidationError("object_count", "Frame exceeds the object-count limit.");
  }
  const sorted = objects.map((object) => ({
    oid: Buffer.from(object.oid),
    type: object.type,
    content: Buffer.from(object.content),
  }));
  sorted.sort((left, right) => Buffer.compare(left.oid, right.oid));
  for (const [index, object] of sorted.entries()) {
    validateOid(object.oid, `objects[${index}].oid`);
    gitObjectTypeName(object.type);
    if (object.content.length > MAX_OBJECT_CONTENT_BYTES) {
      throw new FrameValidationError(
        "object_length",
        `Object ${object.oid.toString("hex")} exceeds the content limit.`,
      );
    }
    if (!gitObjectOid(object.type, object.content).equals(object.oid)) {
      throw new FrameValidationError(
        "object_oid",
        `Object ${object.oid.toString("hex")} does not match its logical content.`,
      );
    }
    if (index > 0 && sorted[index - 1]?.oid.equals(object.oid)) {
      throw new FrameValidationError("duplicate_oid", "Duplicate object OIDs are forbidden.");
    }
  }
  return sorted;
}

function frameByteLength(refNameBytes: number, objects: LogicalGitObject[]): number {
  let length = FIXED_PREFIX_BYTES + refNameBytes + FIXED_REF_SUFFIX_BYTES;
  for (const object of objects) {
    length += OBJECT_PREFIX_BYTES + object.content.length;
  }
  if (!Number.isSafeInteger(length) || length > MAX_FRAME_BYTES) {
    throw new FrameValidationError("frame_length", "Frame exceeds the configured byte limit.");
  }
  return length;
}

export function encodeGitAccountingFrame(frame: GitAccountingFrameV1): Buffer {
  if (frame.accountingVersion !== ACCOUNTING_VERSION) {
    throw new FrameValidationError("accounting_version", "Unsupported accounting version.");
  }
  if (frame.objectFormat !== GIT_SHA256_OBJECT_FORMAT) {
    throw new FrameValidationError("object_format", "Unsupported Git object format.");
  }
  validateRefTransition(frame.operation, frame.oldOid, frame.newOid);
  const refName = validateRefName(frame.refName);
  const objects = validateObjects(frame.objects);
  const length = frameByteLength(refName.length, objects);

  const writer = new BinaryWriter();
  writer.bytes(ACCOUNTING_MAGIC);
  writer.u64(BigInt(length));
  writer.u16(frame.accountingVersion);
  writer.u16(frame.objectFormat);
  writer.u16(frame.authenticatedAgent);
  writer.u32(frame.publicationSlot);
  writer.u8(frame.operation);
  writer.u16(refName.length);
  writer.bytes(refName);
  writer.bytes(frame.oldOid);
  writer.bytes(frame.newOid);
  writer.u32(objects.length);
  for (const object of objects) {
    writer.bytes(object.oid);
    writer.u8(object.type);
    writer.u64(BigInt(object.content.length));
    writer.bytes(object.content);
  }
  const bytes = writer.finish();
  if (bytes.length !== length) {
    throw new FrameValidationError("frame_length", "Encoded frame length is inconsistent.");
  }
  return bytes;
}

export function decodeGitAccountingFrame(bytes: Buffer): GitAccountingFrameV1 {
  if (bytes.length > MAX_FRAME_BYTES) {
    throw new FrameValidationError("frame_length", "Frame exceeds the configured byte limit.");
  }
  const reader = new BinaryReader(bytes);
  if (!reader.bytes(ACCOUNTING_MAGIC.length).equals(ACCOUNTING_MAGIC)) {
    throw new FrameValidationError("magic", "Accounting frame magic does not match.");
  }
  if (reader.u64() !== BigInt(bytes.length)) {
    throw new FrameValidationError("frame_length", "Declared frame length does not match bytes.");
  }
  const accountingVersion = reader.u16();
  const objectFormat = reader.u16();
  const authenticatedAgent = reader.u16();
  const publicationSlot = reader.u32();
  const operation = reader.u8();
  const refBytes = reader.bytes(reader.u16());
  const refName = refBytes.toString("utf8");
  if (!Buffer.from(refName, "utf8").equals(refBytes)) {
    throw new FrameValidationError("ref_name", "Ref name is not valid UTF-8.");
  }
  const oldOid = reader.bytes(GIT_SHA256_OID_BYTES);
  const newOid = reader.bytes(GIT_SHA256_OID_BYTES);
  const objectCount = reader.u32();
  if (objectCount > MAX_OBJECT_COUNT) {
    throw new FrameValidationError("object_count", "Frame exceeds the object-count limit.");
  }
  const objects: LogicalGitObject[] = [];
  for (let index = 0; index < objectCount; index += 1) {
    const oid = reader.bytes(GIT_SHA256_OID_BYTES);
    const type = reader.u8();
    const length = reader.u64();
    if (length > BigInt(MAX_OBJECT_CONTENT_BYTES) || length > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new FrameValidationError("object_length", "Object content length exceeds limits.");
    }
    objects.push({
      oid,
      type: type as GitObjectTypeCode,
      content: reader.bytes(Number(length)),
    });
  }
  if (reader.remaining !== 0) {
    throw new FrameValidationError(
      "trailing_bytes",
      "Frame contains trailing bytes.",
      reader.offset,
    );
  }
  const frame: GitAccountingFrameV1 = {
    accountingVersion: accountingVersion as typeof ACCOUNTING_VERSION,
    authenticatedAgent,
    newOid,
    objectFormat: objectFormat as typeof GIT_SHA256_OBJECT_FORMAT,
    objects,
    oldOid,
    operation: operation as RefOperationCode,
    publicationSlot,
    refName,
  };
  if (!encodeGitAccountingFrame(frame).equals(bytes)) {
    throw new FrameValidationError("canonical", "Frame is not in canonical encoding.");
  }
  return frame;
}

export function gitAccountingCharge(frame: GitAccountingFrameV1): number {
  return encodeGitAccountingFrame(frame).length;
}
