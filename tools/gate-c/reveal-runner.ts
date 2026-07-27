import type { MonotonicClock } from "./config.js";

export interface RevealSlot {
  chapterIndex: number;
  ordinal: number;
  plannedOffsetMs: number;
}

export interface RevealEvent {
  chapterIndex: number;
  observedOffsetMs: number;
  ordinal: number;
  plannedOffsetMs: number;
  schemaVersion: 1;
}

export interface RevealRunnerDependencies {
  clock: MonotonicClock;
  persistEvent(event: RevealEvent): Promise<void>;
  releaseChapter(slot: RevealSlot, event: RevealEvent): Promise<void>;
}

export async function runRevealPlan(
  slots: readonly RevealSlot[],
  dependencies: RevealRunnerDependencies,
): Promise<RevealEvent[]> {
  if (slots.length === 0) {
    throw new Error("Reveal plan must contain at least one slot.");
  }
  for (const [index, slot] of slots.entries()) {
    if (slot.ordinal !== index + 1) {
      throw new Error(`Reveal ordinal ${slot.ordinal} is out of sequence.`);
    }
    if (index > 0 && slot.plannedOffsetMs < slots[index - 1]!.plannedOffsetMs) {
      throw new Error("Reveal offsets must be monotonic.");
    }
  }

  const startMs = dependencies.clock.nowMs();
  const events: RevealEvent[] = [];
  for (const slot of slots) {
    await dependencies.clock.waitUntil(startMs + slot.plannedOffsetMs);
    const event: RevealEvent = {
      chapterIndex: slot.chapterIndex,
      observedOffsetMs: dependencies.clock.nowMs() - startMs,
      ordinal: slot.ordinal,
      plannedOffsetMs: slot.plannedOffsetMs,
      schemaVersion: 1,
    };
    await dependencies.persistEvent(event);
    await dependencies.releaseChapter(slot, event);
    events.push(event);
  }
  return events;
}
