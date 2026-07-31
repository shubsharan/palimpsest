import { describe, expect, it } from "vitest";

import { decodeCheckerResult } from "./checker.js";

describe("blind checker result", () => {
  it("decodes internally consistent coverage without oracle fields", () => {
    expect(
      decodeCheckerResult({
        feedbackId: "published-runnability-coverage-v1",
        outputValidity: "incomplete",
        ciphertextWords: 4,
        outputWords: 2,
        coverage: 0.5,
      }),
    ).toEqual({
      feedbackId: "published-runnability-coverage-v1",
      outputValidity: "incomplete",
      ciphertextWords: 4,
      outputWords: 2,
      coverage: 0.5,
    });
  });

  it.each([
    ["unknown field", { extra: true }],
    ["oracle field", { accuracy: 1 }],
    ["inconsistent validity", { outputValidity: "valid" }],
    ["inconsistent coverage", { coverage: 0.75 }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      decodeCheckerResult({
        feedbackId: "published-runnability-coverage-v1",
        outputValidity: "incomplete",
        ciphertextWords: 4,
        outputWords: 2,
        coverage: 0.5,
        ...override,
      }),
    ).toThrow();
  });

  it("accepts only error-bearing malformed results", () => {
    expect(
      decodeCheckerResult({
        feedbackId: "published-runnability-coverage-v1",
        outputValidity: "malformed",
        error: "candidate could not be read",
      }),
    ).toEqual({
      feedbackId: "published-runnability-coverage-v1",
      outputValidity: "malformed",
      error: "candidate could not be read",
    });
  });
});
