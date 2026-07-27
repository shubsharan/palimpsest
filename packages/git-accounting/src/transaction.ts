import { execFile } from "node:child_process";

import { FrameValidationError } from "./binary.js";
import { parseGitObjectType } from "./git-objects.js";
import { validateRefName, validateRefTransition } from "./policy.js";
import {
  ACCOUNTING_VERSION,
  GIT_SHA256_OBJECT_FORMAT,
  refOperations,
  type GitAccountingFrameV1,
  type LogicalGitObject,
  type RefOperationCode,
} from "./types.js";
import { VisibilityJournal } from "./visibility.js";

interface BuildLogicalTransactionOptions {
  authenticatedAgent: number;
  newOid: string;
  oldOid?: string;
  operation: RefOperationCode;
  publicationSlot: number;
  receivedOids?: Iterable<string>;
  refName: string;
  repository: string;
  slotStartJournal: VisibilityJournal;
}

interface TreeEntry {
  mode: string;
  oid: string;
  path: string;
  type: string;
}

function gitBuffer(repository: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repository, ...args],
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const diagnostics = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr);
          reject(
            new FrameValidationError(
              "git",
              `Git command failed: git ${args.join(" ")}\n${diagnostics.trim()}`,
            ),
          );
          return;
        }
        if (!Buffer.isBuffer(stdout)) {
          reject(new FrameValidationError("git", "Git returned a non-binary stdout value."));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function gitText(repository: string, args: string[]): Promise<string> {
  return (await gitBuffer(repository, args)).toString("utf8").trim();
}

function oidBytes(value: string, label: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new FrameValidationError("oid", `${label} is not a lowercase Git SHA-256 OID.`);
  }
  return Buffer.from(value, "hex");
}

function parseTreeEntries(bytes: Buffer): TreeEntry[] {
  if (bytes.length === 0) {
    return [];
  }
  return bytes
    .subarray(0, bytes.at(-1) === 0 ? -1 : undefined)
    .toString("utf8")
    .split("\0")
    .map((record) => {
      const match = /^(?<mode>[0-9]+) (?<type>[a-z]+) (?<oid>[0-9a-f]{64})\t(?<path>.+)$/.exec(
        record,
      );
      if (!match?.groups) {
        throw new FrameValidationError("tree", `Malformed git ls-tree record: ${record}.`);
      }
      return {
        mode: match.groups.mode!,
        type: match.groups.type!,
        oid: match.groups.oid!,
        path: match.groups.path!,
      };
    });
}

export function validateTreeEntries(entries: TreeEntry[]): void {
  const collisionKeys = new Set<string>();
  for (const entry of entries) {
    if (
      !["040000", "100644", "100755"].includes(entry.mode) ||
      !["tree", "blob"].includes(entry.type)
    ) {
      throw new FrameValidationError(
        "tree_mode",
        `Unsupported Git tree mode/type ${entry.mode} ${entry.type} at ${entry.path}.`,
      );
    }
    const normalized = entry.path.normalize("NFC");
    const parts = entry.path.split("/");
    if (
      normalized !== entry.path ||
      entry.path.startsWith("/") ||
      entry.path.includes("\\") ||
      entry.path.includes("\0") ||
      parts.some((part) => part === "" || part === "." || part === "..") ||
      parts.some((part) => [".gitmodules", ".gitattributes"].includes(part))
    ) {
      throw new FrameValidationError("tree_path", `Unsafe Git tree path: ${entry.path}.`);
    }
    const collisionKey = normalized.toLowerCase();
    if (collisionKeys.has(collisionKey)) {
      throw new FrameValidationError("tree_path", `Case-colliding Git tree path: ${entry.path}.`);
    }
    collisionKeys.add(collisionKey);
  }
}

async function reachableOids(repository: string, newOid: string): Promise<string[]> {
  const output = await gitText(repository, ["rev-list", "--objects", "--no-object-names", newOid]);
  if (output === "") {
    return [];
  }
  const oids = output.split("\n");
  oids.forEach((oid) => oidBytes(oid, "reachable object"));
  return [...new Set(oids)].sort();
}

async function loadLogicalObject(repository: string, oid: string): Promise<LogicalGitObject> {
  const typeName = await gitText(repository, ["cat-file", "-t", oid]);
  const type = parseGitObjectType(typeName);
  const content = await gitBuffer(repository, ["cat-file", typeName, oid]);
  return { content, oid: oidBytes(oid, "object"), type };
}

async function assertCommitAndFastForward(
  options: BuildLogicalTransactionOptions,
  oldOid: string,
): Promise<void> {
  if ((await gitText(options.repository, ["cat-file", "-t", options.newOid])) !== "commit") {
    throw new FrameValidationError("new_tip", "The accepted new ref tip must be a commit.");
  }
  if (options.operation === refOperations.update) {
    const isAncestor = await new Promise<boolean>((resolve, reject) => {
      execFile(
        "git",
        ["-C", options.repository, "merge-base", "--is-ancestor", oldOid, options.newOid],
        { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve(true);
            return;
          }
          if (error.code === 1) {
            resolve(false);
            return;
          }
          const diagnostics = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr);
          reject(
            new FrameValidationError(
              "git",
              `Git ancestry check failed with exit ${String(error.code)}: ${diagnostics.trim()}`,
            ),
          );
        },
      );
    });
    if (!isAncestor) {
      throw new FrameValidationError("fast_forward", "Ref update is not a fast-forward.");
    }
  }
}

export async function buildLogicalTransaction(
  options: BuildLogicalTransactionOptions,
): Promise<GitAccountingFrameV1> {
  validateRefName(options.refName);
  const oldOid = options.oldOid ?? "0".repeat(64);
  const oldOidBytes = oidBytes(oldOid, "oldOid");
  const newOidBytes = oidBytes(options.newOid, "newOid");
  validateRefTransition(options.operation, oldOidBytes, newOidBytes);
  await assertCommitAndFastForward(options, oldOid);

  const treeEntries = parseTreeEntries(
    await gitBuffer(options.repository, ["ls-tree", "-r", "-t", "-z", options.newOid]),
  );
  validateTreeEntries(treeEntries);

  const reachable = await reachableOids(options.repository, options.newOid);
  if (options.receivedOids) {
    const reachableSet = new Set(reachable);
    for (const receivedOid of options.receivedOids) {
      oidBytes(receivedOid, "received object");
      if (!reachableSet.has(receivedOid) && !options.slotStartJournal.has(receivedOid)) {
        throw new FrameValidationError(
          "unreachable_object",
          `Received object is unreachable from the proposed tip: ${receivedOid}.`,
        );
      }
    }
  }
  const newlyVisible = reachable.filter((oid) => !options.slotStartJournal.has(oid));
  const objects = await Promise.all(
    newlyVisible.map((oid) => loadLogicalObject(options.repository, oid)),
  );
  return {
    accountingVersion: ACCOUNTING_VERSION,
    authenticatedAgent: options.authenticatedAgent,
    newOid: newOidBytes,
    objectFormat: GIT_SHA256_OBJECT_FORMAT,
    objects,
    oldOid: oldOidBytes,
    operation: options.operation,
    publicationSlot: options.publicationSlot,
    refName: options.refName,
  };
}
