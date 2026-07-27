import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  ACCOUNTING_MAGIC,
  ACCOUNTING_VERSION,
  FrameValidationError,
  GIT_SHA256_OBJECT_FORMAT,
  decodeGitAccountingFrame,
  encodeGitAccountingFrame,
  gitAccountingCharge,
  gitObjectOid,
  gitObjectTypes,
  refOperations,
  type GitAccountingFrameV1,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

function initialFrame(): GitAccountingFrameV1 {
  const treeContent = Buffer.alloc(0);
  const treeOid = gitObjectOid(gitObjectTypes.tree, treeContent);
  const commitContent = Buffer.from(
    [
      `tree ${treeOid.toString("hex")}`,
      "author Evidence <evidence@palimpsest.invalid> 946684800 +0000",
      "committer Evidence <evidence@palimpsest.invalid> 946684800 +0000",
      "",
      "initial",
      "",
    ].join("\n"),
    "utf8",
  );
  const commitOid = gitObjectOid(gitObjectTypes.commit, commitContent);
  return {
    accountingVersion: ACCOUNTING_VERSION,
    authenticatedAgent: 7,
    newOid: commitOid,
    objectFormat: GIT_SHA256_OBJECT_FORMAT,
    objects: [
      { content: commitContent, oid: commitOid, type: gitObjectTypes.commit },
      { content: treeContent, oid: treeOid, type: gitObjectTypes.tree },
    ],
    oldOid: Buffer.alloc(32),
    operation: refOperations.create,
    publicationSlot: 3,
    refName: "refs/heads/agents/agent-7/evidence",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GitAccountingFrameV1", () => {
  test("round-trips one canonical injective frame", () => {
    const frame = initialFrame();
    const bytes = encodeGitAccountingFrame(frame);
    expect(bytes.subarray(0, 8)).toEqual(ACCOUNTING_MAGIC);
    expect(Number(bytes.readBigUInt64BE(8))).toBe(bytes.length);
    expect(gitAccountingCharge(frame)).toBe(bytes.length);
    expect(encodeGitAccountingFrame(decodeGitAccountingFrame(bytes))).toEqual(bytes);
  });

  test("sorts object records by unsigned raw OID", () => {
    const frame = initialFrame();
    const reversed = { ...frame, objects: [...frame.objects].reverse() };
    expect(encodeGitAccountingFrame(reversed)).toEqual(encodeGitAccountingFrame(frame));
  });

  test("rejects duplicate or content-mismatched objects", () => {
    const frame = initialFrame();
    expect(() =>
      encodeGitAccountingFrame({ ...frame, objects: [frame.objects[0]!, frame.objects[0]!] }),
    ).toThrowError(FrameValidationError);
    expect(() =>
      encodeGitAccountingFrame({
        ...frame,
        objects: [{ ...frame.objects[0]!, content: Buffer.from("changed") }],
      }),
    ).toThrowError(/does not match its logical content/);
  });

  test("rejects invalid ref transitions and ref names", () => {
    const frame = initialFrame();
    expect(() => encodeGitAccountingFrame({ ...frame, oldOid: Buffer.alloc(32, 1) })).toThrowError(
      /zero old OID/,
    );
    expect(() =>
      encodeGitAccountingFrame({ ...frame, refName: "refs/tags/unmetered" }),
    ).toThrowError(/Rejected accounting ref name/);
  });

  test("detects truncation, trailing bytes, and noncanonical ordering", () => {
    const bytes = encodeGitAccountingFrame(initialFrame());
    expect(() => decodeGitAccountingFrame(bytes.subarray(0, -1))).toThrowError(
      /Declared frame length/,
    );
    expect(() => decodeGitAccountingFrame(Buffer.concat([bytes, Buffer.from([0])]))).toThrowError(
      /Declared frame length/,
    );

    const frame = initialFrame();
    const canonical = encodeGitAccountingFrame(frame);
    const firstRecord =
      8 + 8 + 2 + 2 + 2 + 4 + 1 + 2 + Buffer.byteLength(frame.refName) + 32 + 32 + 4;
    const firstLength = 32 + 1 + 8 + frame.objects[0]!.content.length;
    const secondLength = 32 + 1 + 8 + frame.objects[1]!.content.length;
    const reordered = Buffer.concat([
      canonical.subarray(0, firstRecord),
      canonical.subarray(firstRecord + firstLength, firstRecord + firstLength + secondLength),
      canonical.subarray(firstRecord, firstRecord + firstLength),
    ]);
    expect(() => decodeGitAccountingFrame(reordered)).toThrowError();
  });

  test("charges every peer-visible header choice", () => {
    const frame = initialFrame();
    const baseline = encodeGitAccountingFrame(frame);
    const mutations = [
      { ...frame, authenticatedAgent: frame.authenticatedAgent + 1 },
      { ...frame, publicationSlot: frame.publicationSlot + 1 },
      { ...frame, refName: "refs/heads/agents/agent-7/other" },
    ];
    for (const mutation of mutations) {
      expect(encodeGitAccountingFrame(mutation)).not.toEqual(baseline);
    }
  });

  test("matches native Git SHA-256 object identifiers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "palimpsest-git-oid-"));
    temporaryDirectories.push(directory);
    await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", directory]);
    const content = Buffer.from("native object\n", "utf8");
    const inputPath = join(directory, "native-object.txt");
    await writeFile(inputPath, content);
    const { stdout } = await execFileAsync("git", ["hash-object", "-t", "blob", inputPath], {
      cwd: directory,
      encoding: "utf8",
    });
    expect(gitObjectOid(gitObjectTypes.blob, content).toString("hex")).toBe(stdout.trim());
  });
});
