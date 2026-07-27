import { describe, expect, test } from "vitest";

import {
  canonicalArchiveBytes,
  canonicalJsonBytes,
  sha256Hex,
  validateFixture,
} from "../src/index.js";
import { loadArchiveGolden, loadFixtureCases, loadFixtureRaw } from "./helpers.js";

describe("shared contract fixtures", async () => {
  const fixtures = await loadFixtureCases();

  for (const fixture of fixtures) {
    test(fixture.fixtureId, async () => {
      const raw = await loadFixtureRaw(fixture);
      const verdict = validateFixture(fixture.contractId, raw);

      expect(verdict.accepted).toBe(fixture.expected.accepted);
      expect(verdict.reason).toBe(fixture.expected.reason);
      expect(verdict.pointer).toBe(fixture.expected.pointer);

      if (!verdict.accepted) {
        return;
      }

      if (fixture.expected.canonicalUtf8Base64) {
        const bytes = canonicalJsonBytes(verdict.value);
        expect(bytes.toString("base64")).toBe(fixture.expected.canonicalUtf8Base64);
        expect(sha256Hex(bytes)).toBe(fixture.expected.sha256);
      }

      if (fixture.contractId === "canonical-archive") {
        expect(fixture.expected.archivePath).not.toBeNull();
        expect(fixture.expected.sha256).not.toBeNull();
        const bytes = canonicalArchiveBytes(verdict.value);
        const golden = await loadArchiveGolden(fixture.expected.archivePath ?? "");
        expect(bytes).toEqual(golden);
        expect(bytes.length).toBe(fixture.expected.byteLength);
        expect(sha256Hex(bytes)).toBe(fixture.expected.sha256);
      }
    });
  }
});

test("canonical archive ignores caller entry order", () => {
  const entries = [
    { path: "z.txt", kind: "file" as const, contentBase64: "eg==" },
    { path: "a.txt", kind: "file" as const, contentBase64: "YQ==" },
  ];
  const first = canonicalArchiveBytes({
    schemaVersion: 1,
    contractId: "canonical-archive",
    entries,
  });
  const second = canonicalArchiveBytes({
    schemaVersion: 1,
    contractId: "canonical-archive",
    entries: [...entries].reverse(),
  });
  expect(first).toEqual(second);
});
