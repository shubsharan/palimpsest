import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface FixtureExpectation {
  accepted: boolean;
  reason: string | null;
  pointer: string | null;
  canonicalUtf8Base64?: string | null;
  archivePath?: string | null;
  byteLength?: number | null;
  sha256: string | null;
}

export interface FixtureCase {
  fixtureId: string;
  contractId: string;
  inputPath: string;
  expected: FixtureExpectation;
}

interface FixtureManifest {
  schemaVersion: 1;
  fixtures: FixtureCase[];
}

export const fixturesRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

export async function loadFixtureCases(): Promise<FixtureCase[]> {
  const raw = await readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw) as FixtureManifest;
  return manifest.fixtures;
}

export async function loadFixtureRaw(fixture: FixtureCase): Promise<string> {
  return readFile(new URL(`../fixtures/${fixture.inputPath}`, import.meta.url), "utf8");
}

export async function loadArchiveGolden(path: string): Promise<Buffer> {
  return readFile(new URL(`../fixtures/${path}`, import.meta.url));
}
