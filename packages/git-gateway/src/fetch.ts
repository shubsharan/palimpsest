import type { PublishedSnapshot } from "./types.js";

export interface CapturedFetch {
  snapshot: PublishedSnapshot;
  capturedAtConnectionStart: true;
}

export function captureFetchSnapshot(snapshot: PublishedSnapshot): CapturedFetch {
  return { snapshot: structuredClone(snapshot), capturedAtConnectionStart: true };
}
