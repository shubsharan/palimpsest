import type { ErrorObject } from "ajv";

import { canonicalArchiveBytes } from "./archive.js";
import {
  ContractInputError,
  canonicalJsonBytes,
  childPointer,
  parseJsonStrict,
  type ContractReason,
} from "./canonical-json.js";
import { sha256Hex } from "./digest.js";
import { predeclarationDigest } from "./gate-report-core.js";
import { getContractValidator, isContractId, type ContractId } from "./schema-registry.js";

export interface AcceptedVerdict {
  accepted: true;
  canonicalBase64: string;
  pointer: null;
  reason: null;
  sha256: string;
  value: unknown;
}

export interface RejectedVerdict {
  accepted: false;
  canonicalBase64: null;
  pointer: string;
  reason: ContractReason;
  sha256: null;
  value: null;
}

export type ValidationVerdict = AcceptedVerdict | RejectedVerdict;

function reasonForError(error: ErrorObject): ContractReason {
  if (
    error.instancePath === "/schemaVersion" ||
    (error.keyword === "required" && error.params.missingProperty === "schemaVersion")
  ) {
    return "schema_version";
  }
  if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
    return "unknown_field";
  }
  if (error.keyword === "required") {
    return "required";
  }
  if (error.keyword === "type") {
    return "type";
  }
  if (error.keyword === "enum" || error.keyword === "const") {
    return "enum";
  }
  if (
    error.keyword === "minimum" ||
    error.keyword === "maximum" ||
    error.keyword === "minItems" ||
    error.keyword === "maxItems" ||
    error.keyword === "minLength" ||
    error.keyword === "maxLength"
  ) {
    return "range";
  }
  return "format";
}

function pointerForError(error: ErrorObject): string {
  if (error.keyword === "required") {
    return childPointer(error.instancePath, String(error.params.missingProperty));
  }
  if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
    return childPointer(
      error.instancePath,
      String(error.params.additionalProperty ?? error.params.unevaluatedProperty),
    );
  }
  return error.instancePath;
}

function reject(reason: ContractReason, pointer: string): RejectedVerdict {
  return {
    accepted: false,
    canonicalBase64: null,
    pointer,
    reason,
    sha256: null,
    value: null,
  };
}

function validateSchemaVersion(value: unknown): RejectedVerdict | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  ) {
    return reject("schema_version", "/schemaVersion");
  }
}

export function validateValue(contractId: ContractId, value: unknown): ValidationVerdict {
  const versionRejection = validateSchemaVersion(value);
  if (versionRejection) {
    return versionRejection;
  }

  if (contractId === "canonical-archive") {
    try {
      canonicalArchiveBytes(value);
    } catch (error) {
      if (error instanceof ContractInputError) {
        return reject(error.reason, error.pointer);
      }
      throw error;
    }
  }

  const validator = getContractValidator(contractId, value);
  if (!validator(value)) {
    const normalized = (validator.errors ?? [])
      .map((error) => ({
        pointer: pointerForError(error),
        reason: reasonForError(error),
      }))
      .sort(
        (left, right) =>
          left.pointer.localeCompare(right.pointer) || left.reason.localeCompare(right.reason),
      );
    const first = normalized[0];
    if (!first) {
      return reject("format", "");
    }
    return reject(first.reason, first.pointer);
  }

  if (
    contractId === "gate-report" &&
    value !== null &&
    typeof value === "object" &&
    "predeclarationDigest" in value &&
    value.predeclarationDigest !== predeclarationDigest(value as Record<string, unknown>)
  ) {
    return reject("digest", "/predeclarationDigest");
  }

  const bytes = canonicalJsonBytes(value);
  return {
    accepted: true,
    canonicalBase64: bytes.toString("base64"),
    pointer: null,
    reason: null,
    sha256: sha256Hex(bytes),
    value,
  };
}

export function validateFixture(contractId: string, raw: string): ValidationVerdict {
  if (!isContractId(contractId)) {
    return reject("enum", "/contractId");
  }
  let value;
  try {
    value = parseJsonStrict(raw);
  } catch (error) {
    if (error instanceof ContractInputError) {
      return reject(error.reason, error.pointer);
    }
    throw error;
  }
  return validateValue(contractId, value);
}

interface FixtureCase {
  contractId: string;
  expected: {
    accepted: boolean;
  };
  fixtureId: string;
  inputPath: string;
}

interface FixtureManifest {
  fixtures: FixtureCase[];
}

export async function buildFixtureVerdicts(fixturesRoot: URL): Promise<Record<string, unknown>[]> {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", fixturesRoot), "utf8"),
  ) as FixtureManifest;
  const verdicts: Record<string, unknown>[] = [];
  for (const fixture of manifest.fixtures) {
    const raw = await readFile(new URL(fixture.inputPath, fixturesRoot), "utf8");
    const verdict = validateFixture(fixture.contractId, raw);
    let archiveBase64: string | null = null;
    let archiveSha256: string | null = null;
    if (verdict.accepted && fixture.contractId === "canonical-archive") {
      const archive = canonicalArchiveBytes(verdict.value);
      archiveBase64 = archive.toString("base64");
      archiveSha256 = sha256Hex(archive);
    }
    verdicts.push({
      accepted: verdict.accepted,
      archiveBase64,
      archiveSha256,
      canonicalBase64: verdict.accepted ? verdict.canonicalBase64 : null,
      fixtureId: fixture.fixtureId,
      pointer: verdict.pointer,
      reason: verdict.reason,
      sha256: verdict.accepted ? verdict.sha256 : null,
    });
  }
  return verdicts;
}

if (
  import.meta.url === `file://${process.argv[1]}` &&
  process.argv.includes("--fixture-verdicts")
) {
  const fixturesRoot = new URL("../fixtures/", import.meta.url);
  process.stdout.write(`${JSON.stringify(await buildFixtureVerdicts(fixturesRoot))}\n`);
}
