import { describe, expect, test } from "vitest";

import { CumulativeLedger } from "../src/ledger.js";

describe("cumulative communication ledger", () => {
  test("reserves exact charges and rejects one byte over budget", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    expect(ledger.reserve("tx-1", "1".repeat(64), 10)).toMatchObject({
      result: "accepted",
      budgetAfter: 0,
    });
    expect(ledger.reserve("tx-2", "2".repeat(64), 1)).toMatchObject({
      result: "rejected",
      budgetAfter: 0,
    });
  });

  test("is idempotent only for byte-identical transaction effects", () => {
    const ledger = new CumulativeLedger("run-1", "agent-1", 10);
    const first = ledger.reserve("tx-1", "1".repeat(64), 5);
    expect(ledger.reserve("tx-1", "1".repeat(64), 5)).toBe(first);
    expect(() => ledger.reserve("tx-1", "2".repeat(64), 5)).toThrow(/Conflicting/);
  });
});
