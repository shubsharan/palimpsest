import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { sha256Hex, validateValue } from "@palimpsest/contracts";

const instances = ["instance-amber", "instance-birch", "instance-cobalt"];
const publicFields = new Set([
  "schemaVersion",
  "contractId",
  "instanceId",
  "profileId",
  "tokenCount",
  "vocabularySize",
  "cipherView",
  "referenceCorpus",
  "publicScoringVersion",
  "allowedModels",
  "resourcePolicy",
]);

describe("Gate B public projection", () => {
  it.each(instances)("%s is allowlisted and source-blind", async (instanceId) => {
    const manifest = JSON.parse(
      await readFile(`artifacts/gate-b/instances/${instanceId}/public/manifest.json`, "utf8"),
    );
    const verdict = validateValue("gate-b-public-instance-manifest", manifest);
    expect(verdict).toMatchObject({ accepted: true });
    expect(new Set(Object.keys(manifest))).toEqual(publicFields);
    const sourceRecord = JSON.parse(
      await readFile(`artifacts/gate-b/instances/${instanceId}/sealed/source-record.json`, "utf8"),
    );
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain(sourceRecord.sourceId);
    expect(serialized).not.toContain(sourceRecord.title);
    expect(serialized).not.toContain(sourceRecord.author);
    expect(serialized).not.toContain(sourceRecord.rawArtifact.sha256);
    expect(serialized).not.toContain("preparedPlaintext");
    expect(serialized).not.toContain("encryptionKey");
  });

  it("cipher views are not byte-identical to sealed prepared text", async () => {
    for (const instanceId of instances) {
      const cipher = await readFile(`artifacts/gate-b/instances/${instanceId}/public/cipher.txt`);
      const prepared = await readFile(
        `artifacts/gate-b/instances/${instanceId}/sealed/prepared.txt`,
      );
      expect(sha256Hex(cipher)).not.toBe(sha256Hex(prepared));
    }
  });
});
