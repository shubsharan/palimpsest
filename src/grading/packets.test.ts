import { describe, expect, it } from "vitest";

import { canonicalJson, contentDigest } from "../canonical.js";
import type { EvidenceBundle, EvidenceItem, EvidenceReference } from "./contracts.js";
import {
  compileReviewPackets,
  decodeReviewPacket,
  packetLedgersForEvidence,
  REVIEW_PACKET_MAX_BYTES,
  REVIEW_PACKET_MAX_CITATIONS,
} from "./packets.js";

const DIGEST = "a".repeat(64);

function traceReference(sequence: number): EvidenceReference {
  return {
    source: "trace",
    traceSequence: sequence,
    excerptDigest: contentDigest({ sequence }),
    role: "context",
  };
}

function evidence(
  sequence: number,
  kind: string,
  content: EvidenceItem["content"],
  actorId = "actor-1",
): EvidenceItem {
  return {
    evidenceId: `e-${String(sequence).padStart(4, "0")}`,
    atMs: sequence,
    actorId,
    kind,
    content,
    reference: traceReference(sequence),
    availability: "full",
  };
}

function bundle(
  items: readonly EvidenceItem[],
  communicationMode: "shared" | "isolated" = "shared",
) {
  return {
    schemaVersion: 1,
    bundleId: "bundle-test",
    runFingerprint: DIGEST,
    communicationMode,
    actors: ["actor-1", "actor-2"],
    items,
    windows: [],
    omissions: [],
    sourceDigest: DIGEST,
    contentDigest: contentDigest({ communicationMode, items }),
  } as const satisfies EvidenceBundle;
}

function compile(
  items: readonly EvidenceItem[],
  communicationMode: "shared" | "isolated" = "shared",
) {
  return compileReviewPackets({
    bundle: bundle(items, communicationMode),
    originId: communicationMode === "shared" ? "shared" : "agent-1",
    originOrdinal: 1,
    configurationDigest: "b".repeat(64),
    rubricDigest: "c".repeat(64),
  });
}

describe("ledger review packet compilation", () => {
  it("routes by observable kind, pairs tool calls, strips duplicate response calls, and accounts for omissions", () => {
    const items = [
      evidence(1, "run.context", { communicationMode: "shared" }, "runner"),
      evidence(2, "model.response", {
        reasoningSummary: "Two mappings remain plausible.",
        toolCalls: [{ id: "call-1", name: "run_command" }],
      }),
      evidence(3, "tool.started", {
        id: "call-1",
        name: "run_command",
        arguments: { command: "python solver.py" },
      }),
      evidence(
        4,
        "team.message",
        { author: "actor-2", message: "I reproduced the check." },
        "actor-2",
      ),
      evidence(5, "tool.completed", { id: "call-1", name: "run_command", output: "ok" }),
      evidence(6, "git.canonical", { path: "solver.py" }, "runner"),
      evidence(
        7,
        "evaluation.completed",
        { matchedWords: 100, plaintext: "prohibited-outcome" },
        "runner",
      ),
    ];

    const first = compile(items);
    const second = compile(items);
    const [epistemic, social, instrumental] = first;

    expect(first).toEqual(second);
    expect(first.map(({ ledger }) => ledger)).toEqual(["epistemic", "social", "instrumental"]);
    expect(epistemic.items.find(({ kind }) => kind === "tool.exchange")?.citationIds).toHaveLength(
      2,
    );
    expect(epistemic.items.find(({ kind }) => kind === "model.response")?.content).toEqual({
      reasoningSummary: "Two mappings remain plausible.",
    });
    expect(social.citations.map(({ evidenceId }) => evidenceId)).toContain("e-0004");
    expect(instrumental.omissions).toContainEqual(
      expect.objectContaining({ evidenceId: "e-0007" }),
    );
    expect(canonicalJson(first)).not.toContain("prohibited-outcome");
    expect(canonicalJson(first)).not.toContain("matchedWords");
    expect(
      new Set(
        first.flatMap((packet) => [
          ...packet.citations.map(({ evidenceId }) => evidenceId),
          ...packet.omissions.map(({ evidenceId }) => evidenceId),
        ]),
      ),
    ).toEqual(new Set(items.map(({ evidenceId }) => evidenceId)));
    expect(
      first.every(
        (packet) => Buffer.byteLength(canonicalJson(packet), "utf8") <= REVIEW_PACKET_MAX_BYTES,
      ),
    ).toBe(true);
    for (const packet of first) {
      const { contentDigest: claimed, ...content } = packet;
      expect(claimed).toBe(contentDigest(content));
      expect(decodeReviewPacket(JSON.parse(JSON.stringify(packet)))).toEqual(packet);
    }
    expect(() =>
      decodeReviewPacket({ ...epistemic, packetId: "packet-epistemic-tampered" }),
    ).toThrow(/packetId does not match/i);
  });

  it("uses bounded deterministic head/tail projections to keep large packets below 256 KiB", () => {
    const items = Array.from({ length: 80 }, (_, index) =>
      evidence(index + 1, "model.response", {
        reasoningSummary: `${String(index)}:${"x".repeat(8_000)}:${String(index)}`,
        toolCalls: [{ id: `call-${String(index)}`, name: "run_command" }],
      }),
    );

    const packets = compile(items);

    expect(
      packets.every(
        (packet) => Buffer.byteLength(canonicalJson(packet), "utf8") <= REVIEW_PACKET_MAX_BYTES,
      ),
    ).toBe(true);
    expect(
      packets.flatMap(({ items }) => items).some(({ projection }) => projection === "excerpted"),
    ).toBe(true);
    expect(canonicalJson(packets)).not.toContain("toolCalls");
    expect(compile(items)).toEqual(packets);
  });

  it("returns a social packet for isolated evidence so orchestration can skip it deterministically", () => {
    const packets = compile(
      [evidence(1, "run.context", { communicationMode: "isolated" }, "runner")],
      "isolated",
    );

    expect(packets).toHaveLength(3);
    expect(packets[1]).toMatchObject({ ledger: "social", origin: { ordinal: 1 } });
    expect(JSON.stringify(packets)).not.toContain('"origin":{"id"');
  });

  it("rejects a citation index beyond the portable structured-schema limit", () => {
    const items = Array.from({ length: REVIEW_PACKET_MAX_CITATIONS + 1 }, (_, index) =>
      evidence(index + 1, "model.response", { reasoningSummary: String(index) }),
    );

    expect(() => compile(items)).toThrow(/citation.*portable structured-schema limit/i);
  });

  it("fails preflight when reference metadata alone cannot fit", () => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      ...evidence(index + 1, "model.response", { reasoningSummary: String(index) }),
      evidenceId: `e-${"x".repeat(3_000)}-${String(index)}`,
    }));

    expect(() => compile(items)).toThrow(/reference index cannot fit/i);
  });

  it("requires an exact order-preserving origin subset", () => {
    const items = [
      evidence(1, "model.response", { reasoningSummary: "first" }),
      evidence(2, "model.response", { reasoningSummary: "second" }),
    ];
    const source = bundle(items, "isolated");
    const options = {
      bundle: source,
      originId: "agent-1",
      originOrdinal: 1,
      configurationDigest: "b".repeat(64),
      rubricDigest: "c".repeat(64),
    } as const;

    expect(() => compileReviewPackets({ ...options, items: [items[1]!, items[0]!] })).toThrow(
      /preserve bundle order/i,
    );
    expect(() =>
      compileReviewPackets({
        ...options,
        items: [{ ...items[0]!, content: { reasoningSummary: "changed" } }],
      }),
    ).toThrow(/not an exact bundle item/i);
  });

  it("keeps routing independent of content quality", () => {
    const useful = evidence(1, "tool.completed", { id: "a", output: "useful" });
    const failed = evidence(2, "tool.completed", { id: "b", output: { error: "failed" } });

    expect(packetLedgersForEvidence(useful)).toEqual(packetLedgersForEvidence(failed));
  });
});
