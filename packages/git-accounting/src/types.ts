export const ACCOUNTING_MAGIC = Buffer.from("PLMPGIT1", "ascii");
export const ACCOUNTING_VERSION = 1 as const;
export const GIT_SHA256_OBJECT_FORMAT = 1 as const;
export const GIT_SHA256_OID_BYTES = 32;

export const gitObjectTypes = {
  commit: 1,
  tree: 2,
  blob: 3,
} as const;

export type GitObjectTypeCode = (typeof gitObjectTypes)[keyof typeof gitObjectTypes];
export type GitObjectTypeName = keyof typeof gitObjectTypes;

export const refOperations = {
  create: 1,
  update: 2,
} as const;

export type RefOperationCode = (typeof refOperations)[keyof typeof refOperations];

export interface LogicalGitObject {
  content: Buffer;
  oid: Buffer;
  type: GitObjectTypeCode;
}

export interface GitAccountingFrameV1 {
  accountingVersion: typeof ACCOUNTING_VERSION;
  authenticatedAgent: number;
  newOid: Buffer;
  objectFormat: typeof GIT_SHA256_OBJECT_FORMAT;
  objects: LogicalGitObject[];
  oldOid: Buffer;
  operation: RefOperationCode;
  publicationSlot: number;
  refName: string;
}
