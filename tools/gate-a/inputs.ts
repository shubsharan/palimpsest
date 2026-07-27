import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256Hex, validateValue } from "@palimpsest/contracts";

import { referenceFile, writeCanonicalJson } from "./artifacts.js";
import {
  gateABudgetsBytes,
  gateAGeometries,
  gateARetainedGeometryId,
  gateASourceDefinitions,
  gateAStrategies,
  gateATimingModel,
  gateAUsefulState,
} from "./config.js";
import { timingCapacityResult } from "./timing-capacity.js";

const inputRoot = resolve("artifacts/gate-a/inputs");

async function sourceReferences() {
  return Promise.all(
    gateASourceDefinitions.map(async ({ sourceId }) => ({
      sourceId,
      ...(await referenceFile(
        resolve(inputRoot, "sources", `${sourceId}.txt`),
        "public-domain-source",
      )),
    })),
  );
}

async function fixtureReferences() {
  const names = (await readdir(resolve(inputRoot, "fixtures")))
    .filter((name) => /^tokens-[0-9]+-vocab-[0-9]+\.json$/.test(name))
    .sort();
  const references = [];
  for (const name of names) {
    const metadata = JSON.parse(await readFile(resolve(inputRoot, "fixtures", name), "utf8"));
    const geometry = gateAGeometries.find(({ geometryId }) => geometryId === metadata.geometryId);
    if (!geometry) {
      throw new Error(`Generated fixture is not in the frozen matrix: ${metadata.geometryId}`);
    }
    references.push({
      geometryId: geometry.geometryId,
      metadata: await referenceFile(
        resolve(inputRoot, "fixtures", name),
        "channel-fixture-metadata",
      ),
      opaqueShard: await referenceFile(
        resolve(inputRoot, "fixtures", `${geometry.geometryId}.opaque.txt`),
        "opaque-shard",
      ),
      tokenIds: await referenceFile(
        resolve(inputRoot, "fixtures", `${geometry.geometryId}.token-ids.bin`),
        "opaque-token-ids",
      ),
      vocabulary: await referenceFile(
        resolve(inputRoot, "fixtures", `${geometry.geometryId}.vocabulary.json`),
        "shared-vocabulary",
      ),
    });
  }
  if (references.length !== gateAGeometries.length) {
    throw new Error(
      `Expected ${gateAGeometries.length} generated fixtures, received ${references.length}.`,
    );
  }
  return references;
}

async function usefulStateReferences() {
  const references = [];
  for (let version = 1; version <= 4; version += 1) {
    const checkpointId = `belief-v${version}`;
    const path = resolve(inputRoot, "useful", `${checkpointId}.json`);
    const checkpoint = JSON.parse(await readFile(path, "utf8"));
    const verdict = validateValue("useful-state-checkpoint", checkpoint);
    if (!verdict.accepted) {
      throw new Error(
        `Generated ${checkpointId} is invalid: ${verdict.reason} at ${verdict.pointer}.`,
      );
    }
    references.push({
      checkpointId,
      ...(await referenceFile(path, "useful-state-checkpoint")),
    });
  }
  return references;
}

const timing = timingCapacityResult();
await writeCanonicalJson(resolve(inputRoot, "timing-capacity.json"), timing);
const provenanceBytes = await readFile(resolve(inputRoot, "sources/provenance.json"));
const manifest = {
  budgets: {
    inclusiveMaximumBytes: gateABudgetsBytes.at(-1),
    inclusiveMinimumBytes: gateABudgetsBytes[0],
    pointsBytes: gateABudgetsBytes,
    stepBytes: 1_024,
  },
  commonSideInformation: {
    granted: [
      "normalization algorithm and version",
      "source corpus and exact byte digests",
      "shared vocabulary order for each geometry",
      "Git genesis and writable-ref policy",
      "codec identifiers, versions, parameters, and decoders",
      "fixture token and vocabulary geometry",
    ],
    withheld: ["opaque shard token sequence", "decoded semantic answer"],
  },
  decisionRule: {
    capacityCredit: "relayMinimumChargeBytes - separateCapacityBytes > budgetBytes",
    minimumAdjacentPassingPoints: 3,
    point:
      "usefulMaximumChargeBytes <= budgetBytes && relayMinimumChargeBytes - separateCapacityBytes > budgetBytes",
  },
  fixtures: await fixtureReferences(),
  geometryMatrix: gateAGeometries,
  retainedGeometryId: gateARetainedGeometryId,
  git: {
    objectFormat: "sha256",
    writableRefPrefix: "refs/heads/agents/<authenticated-agent>/",
    accountingFrame: "GitAccountingFrameV1",
    oneRefUpdatePerTransaction: true,
    representationBytesAreDiagnosticOnly: true,
  },
  normalizationVersion: "1.0.0",
  provenance: {
    artifactType: "gate-a-source-provenance",
    byteLength: provenanceBytes.length,
    sha256: sha256Hex(provenanceBytes),
  },
  schemaVersion: 1,
  sourceReferences: await sourceReferences(),
  strategyMatrix: gateAStrategies,
  timingModel: {
    ...gateATimingModel,
    result: timing,
  },
  usefulStateWorkload: {
    ...gateAUsefulState,
    checkpoints: await usefulStateReferences(),
  },
};
await writeCanonicalJson(resolve(inputRoot, "input-manifest.json"), manifest);
