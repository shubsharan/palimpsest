import { describe, expect, test } from "vitest";

import {
  FIXTURE_ADAPTER_ID,
  attemptPath,
  assertAdapterAuthorized,
  type OfflineHarnessAuthorization,
} from "../../tools/harness/config.js";

const identity = {
  declarationDigest: "a".repeat(64),
  runId: "run-001",
};

describe("offline harness configuration", () => {
  test("uses an explicit immutable attempt identity", () => {
    expect(attemptPath("artifacts/harness", identity)).toBe(
      `artifacts/harness/attempts/${"a".repeat(64)}/run-001`,
    );
    expect(() =>
      attemptPath("artifacts/harness", {
        declarationDigest: "../mutable",
        runId: "run-001",
      }),
    ).toThrow(/declaration digest/i);
    expect(() =>
      attemptPath("artifacts/harness", {
        declarationDigest: "a".repeat(64),
        runId: "../latest",
      }),
    ).toThrow(/run ID/i);
  });

  test("permits only the fixture adapter before offline completion", () => {
    expect(() => assertAdapterAuthorized(FIXTURE_ADAPTER_ID)).not.toThrow();
    expect(() => assertAdapterAuthorized("openai-responses-v1")).toThrow(
      /offline harness completion/i,
    );
  });

  test("binds a later adapter to one passing harness report", () => {
    const authorization: OfflineHarnessAuthorization = {
      schemaVersion: 1,
      contractId: "offline-harness-report",
      declarationDigest: "b".repeat(64),
      runId: "offline-001",
      reportDigest: "c".repeat(64),
      result: "pass",
      liveModelValidationAuthorized: true,
      allowedAdapterIds: ["openai-responses-v1"],
    };
    expect(() => assertAdapterAuthorized("openai-responses-v1", authorization)).not.toThrow();
    expect(() => assertAdapterAuthorized("other-provider-v1", authorization)).toThrow(
      /not authorized/i,
    );
  });
});
