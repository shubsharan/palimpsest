import { createHash } from "node:crypto";

import { FrameValidationError } from "./binary.js";
import {
  GIT_SHA256_OID_BYTES,
  gitObjectTypes,
  type GitObjectTypeCode,
  type GitObjectTypeName,
} from "./types.js";

const namesByCode = new Map<GitObjectTypeCode, GitObjectTypeName>(
  Object.entries(gitObjectTypes).map(([name, code]) => [code, name as GitObjectTypeName]),
);

export function gitObjectTypeName(type: GitObjectTypeCode): GitObjectTypeName {
  const name = namesByCode.get(type);
  if (!name) {
    throw new FrameValidationError("object_type", `Unsupported Git object type code: ${type}.`);
  }
  return name;
}

export function gitObjectOid(type: GitObjectTypeCode, content: Buffer): Buffer {
  const name = gitObjectTypeName(type);
  const header = Buffer.from(`${name} ${content.length}\0`, "ascii");
  const oid = createHash("sha256").update(header).update(content).digest();
  if (oid.length !== GIT_SHA256_OID_BYTES) {
    throw new FrameValidationError("oid", "Git SHA-256 produced an unexpected digest width.");
  }
  return oid;
}

export function parseGitObjectType(value: string): GitObjectTypeCode {
  if (value === "commit" || value === "tree" || value === "blob") {
    return gitObjectTypes[value];
  }
  throw new FrameValidationError("object_type", `Unsupported Git object type: ${value}.`);
}
