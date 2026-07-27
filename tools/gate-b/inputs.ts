import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { referenceFile, writeCanonicalJson } from "./artifacts.js";
import {
  gateBDecisionThresholds,
  gateBFrontierModel,
  gateBFrontierReasoningEffort,
  gateBInstances,
  gateBModelRevision,
  gateBProfileId,
  gateBSpacyModel,
  gateBTargetTokenCount,
} from "./config.js";

const gateBRoot = resolve("artifacts/gate-b");
const modelRoot = resolve(gateBRoot, "inputs/models/distilroberta-base");
const modelFiles = [
  "config.json",
  "merges.txt",
  "model.safetensors",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

async function sourceReferences() {
  return Promise.all(
    gateBInstances.map(async (instance) => ({
      diagnosticRole: instance.diagnosticRole,
      instanceId: instance.instanceId,
      sourceId: instance.sourceId,
      tier: instance.tier,
      interiorChapterIndex: instance.interiorChapterIndex,
      seedHex: instance.seedHex,
      rawArtifact: await referenceFile(instance.sourcePath, "public-domain-source"),
      entityReview: await referenceFile(instance.entityReviewPath, "entity-review-patch"),
    })),
  );
}

async function modelReferences() {
  return Promise.all(
    modelFiles.map(async (name) => ({
      name,
      ...(await referenceFile(resolve(modelRoot, name), "masked-language-model-file")),
    })),
  );
}

export async function buildGateBInputManifest() {
  const policies = await Promise.all(
    [
      "frontier-agent-tools",
      "human-tools",
      "instructions",
      "mechanical",
      "pre-solve-admission",
    ].map(async (name) => ({
      name,
      ...(await referenceFile(
        resolve(gateBRoot, "inputs/solver-policies", `${name}.json`),
        "solver-policy",
      )),
    })),
  );
  return {
    schemaVersion: 1,
    profileId: gateBProfileId,
    targetTokenCount: gateBTargetTokenCount,
    instances: await sourceReferences(),
    targetExcludedReferenceCorpus: await referenceFile(
      "artifacts/gate-a/inputs/sources/count-of-monte-cristo.txt",
      "target-excluded-reference-corpus",
    ),
    models: {
      frontierAgent: {
        model: gateBFrontierModel,
        reasoningEffort: gateBFrontierReasoningEffort,
        sdk: "openai-python-2.48.0",
      },
      distilroberta: {
        revision: gateBModelRevision,
        files: await modelReferences(),
      },
      spacy: gateBSpacyModel,
    },
    policies,
    scoringVersion: "1.0.0",
    thresholds: gateBDecisionThresholds,
    environmentFiles: await Promise.all(
      ["package.json", "pnpm-lock.yaml", "python/pyproject.toml", "python/uv.lock"].map(
        async (path) => ({
          path,
          ...(await referenceFile(path, "dependency-manifest")),
        }),
      ),
    ),
    fullHarnessAuthorized: false,
  };
}

export async function writeGateBInputManifest(): Promise<void> {
  await writeCanonicalJson(
    resolve(gateBRoot, "inputs/input-manifest.json"),
    await buildGateBInputManifest(),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeGateBInputManifest();
}
