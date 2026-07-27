import { join } from "node:path";

import type { PublishedSnapshot, RefMap } from "@palimpsest/git-gateway";

export const PUBLICATION_SLOTS = {
  collaboration: 1,
  final: 2,
} as const;

export type PublicationSlot = keyof typeof PUBLICATION_SLOTS;
export type PublicationOrdinal = (typeof PUBLICATION_SLOTS)[PublicationSlot];

export interface PublicationRequest {
  slot: PublicationSlot;
  eventSequence: number;
}

export interface GatewayPublicationEvidence {
  schemaVersion: 1;
  slot: PublicationSlot;
  snapshot: PublishedSnapshot;
  refs: RefMap;
  allowedOidCount: number;
  allowedOidsDigest: string;
  maxFetchesPerAgent: number;
}

export function publicationOrdinal(slot: PublicationSlot): PublicationOrdinal {
  return PUBLICATION_SLOTS[slot];
}

export function publicationSlot(ordinal: number): PublicationSlot {
  const entry = Object.entries(PUBLICATION_SLOTS).find(([, value]) => value === ordinal);
  if (!entry) {
    throw new Error(`Unknown publication ordinal: ${ordinal}.`);
  }
  return entry[0] as PublicationSlot;
}

export function publicationSuffix(slot: PublicationSlot): string {
  return String(publicationOrdinal(slot)).padStart(3, "0");
}

export function gatewayPublicationPaths(repository: string, slot: PublicationSlot) {
  const suffix = publicationSuffix(slot);
  return {
    request: join(repository, `gateway-publication-request-${suffix}.json`),
    evidence: join(repository, `gateway-publication-${suffix}.json`),
    marker: join(repository, `gateway-published-${suffix}`),
    error: join(repository, `gateway-publish-error-${suffix}`),
  };
}

export function attemptPublicationPaths(attempt: string, slot: PublicationSlot) {
  const suffix = publicationSuffix(slot);
  return {
    publication: join(attempt, "git", `publication-${suffix}.json`),
    fetchPublication: join(attempt, "git", `fetch-publication-${suffix}.json`),
  };
}
