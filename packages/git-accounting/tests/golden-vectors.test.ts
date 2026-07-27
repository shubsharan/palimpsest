import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  FrameValidationError,
  decodeGitAccountingFrame,
  encodeGitAccountingFrame,
} from "../src/index.js";

interface Vector {
  expectedReason?: string;
  filename: string;
  sha256: string;
}

interface Manifest {
  accepted: Vector[];
  rejected: Vector[];
}

async function manifest(): Promise<Manifest> {
  return JSON.parse(await readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8"));
}

describe("frozen GitAccountingFrameV1 vectors", () => {
  test("accepted vectors are canonical decode/re-encode identities", async () => {
    for (const vector of (await manifest()).accepted) {
      const bytes = await readFile(new URL(`../fixtures/${vector.filename}`, import.meta.url));
      expect(encodeGitAccountingFrame(decodeGitAccountingFrame(bytes))).toEqual(bytes);
    }
  });

  test("rejected vectors fail with the frozen reason", async () => {
    for (const vector of (await manifest()).rejected) {
      const bytes = await readFile(new URL(`../fixtures/${vector.filename}`, import.meta.url));
      try {
        decodeGitAccountingFrame(bytes);
        throw new Error(`${vector.filename} unexpectedly decoded.`);
      } catch (error) {
        expect(error).toBeInstanceOf(FrameValidationError);
        expect((error as FrameValidationError).code).toBe(vector.expectedReason);
      }
    }
  });
});
