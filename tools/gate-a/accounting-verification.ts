import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256Hex } from "@palimpsest/contracts";
import {
  VisibilityJournal,
  buildLogicalTransaction,
  decodeGitAccountingFrame,
  encodeGitAccountingFrame,
  refOperations,
} from "@palimpsest/git-accounting";

import { referenceFile, writeCanonicalJson } from "./artifacts.js";
import { createNativeGitFixture, framesAcrossPackProfiles } from "./native-git.js";

const fixtureRoot = resolve("packages/git-accounting/fixtures");
const rawRoot = resolve("artifacts/gate-a/raw");

async function writeVector(name: string, bytes: Buffer) {
  const path = resolve(fixtureRoot, `${name}.bin`);
  await writeFile(path, bytes);
  return {
    filename: `${name}.bin`,
    ...(await referenceFile(path, "git-accounting-frame")),
  };
}

const fixture = await createNativeGitFixture();
try {
  await mkdir(fixtureRoot, { recursive: true });
  await mkdir(rawRoot, { recursive: true });

  const first = await buildLogicalTransaction({
    authenticatedAgent: 1,
    newOid: fixture.firstTip,
    operation: refOperations.create,
    publicationSlot: 0,
    refName: "refs/heads/agents/agent-1/work",
    repository: fixture.repository,
    slotStartJournal: new VisibilityJournal(),
  });
  const firstBytes = encodeGitAccountingFrame(first);
  const journal = new VisibilityJournal().withAcceptedObjects([first.objects]);
  const second = await buildLogicalTransaction({
    authenticatedAgent: 1,
    newOid: fixture.tip,
    oldOid: fixture.firstTip,
    operation: refOperations.update,
    publicationSlot: 1,
    refName: "refs/heads/agents/agent-1/work",
    repository: fixture.repository,
    slotStartJournal: journal,
  });
  const secondBytes = encodeGitAccountingFrame(second);

  const accepted = [
    { name: "accepted-create", ...(await writeVector("accepted-create", firstBytes)) },
    { name: "accepted-update", ...(await writeVector("accepted-update", secondBytes)) },
  ];
  const rejectedBytes = [
    {
      expectedReason: "magic",
      name: "rejected-magic",
      payload: Buffer.concat([Buffer.from("BADMAGIC"), firstBytes.subarray(8)]),
    },
    {
      expectedReason: "frame_length",
      name: "rejected-truncated",
      payload: firstBytes.subarray(0, -1),
    },
    {
      expectedReason: "frame_length",
      name: "rejected-trailing",
      payload: Buffer.concat([firstBytes, Buffer.from([0])]),
    },
    {
      expectedReason: "object_oid",
      name: "rejected-content-mutation",
      payload: Buffer.concat([firstBytes.subarray(0, -1), Buffer.from([firstBytes.at(-1)! ^ 1])]),
    },
  ];
  const rejected = [];
  for (const vector of rejectedBytes) {
    let observedReason = "accepted";
    try {
      decodeGitAccountingFrame(vector.payload);
    } catch (error) {
      observedReason =
        error instanceof Error && "code" in error ? String(error.code) : "unexpected-error";
    }
    if (observedReason !== vector.expectedReason) {
      throw new Error(
        `${vector.name}: expected ${vector.expectedReason}, observed ${observedReason}.`,
      );
    }
    rejected.push({
      expectedReason: vector.expectedReason,
      name: vector.name,
      ...(await writeVector(vector.name, vector.payload)),
    });
  }

  const manifest = {
    accepted,
    accountingVersion: 1,
    objectFormat: "sha256",
    rejected,
    schemaVersion: 1,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(resolve(fixtureRoot, "manifest.json"), manifestBytes);

  const profiles = await framesAcrossPackProfiles(fixture);
  const uniqueFrameDigests = new Set(profiles.map(({ frame }) => sha256Hex(frame)));
  if (uniqueFrameDigests.size !== 1) {
    throw new Error("Native Git pack profiles produced distinct accounting frames.");
  }
  await writeCanonicalJson(resolve(rawRoot, "accounting-verification.json"), {
    acceptedVectorCount: accepted.length,
    closure: {
      createObjectCount: first.objects.length,
      updateNewlyVisibleObjectCount: second.objects.length,
    },
    frameDigest: [...uniqueFrameDigests][0],
    goldenManifest: {
      artifactType: "git-accounting-golden-manifest",
      byteLength: manifestBytes.length,
      sha256: sha256Hex(manifestBytes),
    },
    mutationAndMalformedVectorCount: rejected.length,
    packProfiles: profiles.map(({ frame, profileId }) => ({
      frameByteLength: frame.length,
      frameSha256: sha256Hex(frame),
      profileId,
    })),
    result: "pass",
    schemaVersion: 1,
    slotStartJournal: {
      beforeUpdateSha256: journal.digest(),
      afterUpdateSha256: journal.withAcceptedObjects([second.objects]).digest(),
    },
  });
} finally {
  await rm(fixture.repository, { force: true, recursive: true });
}
