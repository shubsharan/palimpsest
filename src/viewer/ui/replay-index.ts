import type {
  DecodeCheckpoint,
  DecodeWordState,
  ViewerEvent,
  ViewerEventCategory,
  ViewerRun,
  ViewerToolCall,
} from "../contracts.js";

// One definition of a "word" so the tokenizer that renders the reconstruction
// and the counter that sizes the decode state array cannot drift apart. The `g`
// flag is required by `matchAll`; `matchAll` does not read or mutate `lastIndex`,
// so sharing a single instance is safe.
const WORD_PATTERN = /\p{L}+(?:['’]\p{L}+)*/gu;

export interface TextSpan {
  surface: string;
  wordIndex?: number;
}

export interface TextLine {
  key: number;
  spans: readonly TextSpan[];
}

export type ViewerLaneItem =
  | {
      kind: "event";
      atMs: number;
      sequence: number;
      category: ViewerEventCategory;
      event: ViewerEvent;
    }
  | {
      kind: "tool";
      atMs: number;
      sequence: number;
      category: "tool";
      call: ViewerToolCall;
    };

export interface ViewerLaneIndex {
  agentId: string;
  model: string;
  items: readonly ViewerLaneItem[];
  itemTimes: readonly number[];
  transitionTimes: readonly number[];
}

export interface ViewerReplayIndex {
  lanes: readonly ViewerLaneIndex[];
  teamMessageTimes: readonly number[];
}

export interface DecodeSnapshot {
  checkpoint: DecodeCheckpoint;
  candidates: readonly (string | null | undefined)[];
  states: Uint8Array;
}

const STATE_CODES: Readonly<Record<DecodeWordState, number>> = {
  "newly-correct": 1,
  "previously-correct": 2,
  regressed: 3,
  "changed-incorrect": 4,
  unchanged: 0,
};

const STATE_NAMES: readonly (DecodeWordState | undefined)[] = [
  "unchanged",
  "newly-correct",
  "previously-correct",
  "regressed",
  "changed-incorrect",
];

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function lane(items: readonly ViewerLaneItem[], agentId: string, model: string): ViewerLaneIndex {
  const sorted = [...items].sort(
    (left, right) => left.atMs - right.atMs || left.sequence - right.sequence,
  );
  return {
    agentId,
    model,
    items: sorted,
    itemTimes: sorted.map(({ atMs }) => atMs),
    transitionTimes: uniqueSorted(
      sorted.flatMap((item) =>
        item.kind === "tool" && item.call.completedAtMs !== undefined
          ? [item.atMs, item.call.completedAtMs]
          : [item.atMs],
      ),
    ),
  };
}

export function buildViewerReplayIndex(run: ViewerRun): ViewerReplayIndex {
  const items = new Map<string, ViewerLaneItem[]>();
  for (const event of run.events) {
    if (event.agentId === undefined || event.display === undefined) continue;
    const laneItems = items.get(event.agentId) ?? [];
    laneItems.push({
      kind: "event",
      atMs: event.atMs,
      sequence: event.sequence,
      category: event.category,
      event,
    });
    items.set(event.agentId, laneItems);
  }
  for (const call of run.toolCalls) {
    const laneItems = items.get(call.agentId) ?? [];
    laneItems.push({
      kind: "tool",
      atMs: call.startedAtMs,
      sequence: call.startedSequence,
      category: "tool",
      call,
    });
    items.set(call.agentId, laneItems);
  }
  return {
    lanes: run.agents.map((agent) =>
      lane(
        items.get(agent.agentId) ?? [],
        agent.agentId,
        agent.actualModel ?? agent.requestedModel,
      ),
    ),
    teamMessageTimes: run.teamMessages.map(({ atMs }) => atMs),
  };
}

export function filterViewerLane(
  source: ViewerLaneIndex,
  filters: ReadonlySet<ViewerEventCategory>,
): ViewerLaneIndex {
  return lane(
    source.items.filter(({ category }) => filters.has(category)),
    source.agentId,
    source.model,
  );
}

export function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function replayTimeAt(
  anchorPlayhead: number,
  elapsedMs: number,
  speed: number,
  durationMs: number,
): number {
  return Math.min(durationMs, anchorPlayhead + Math.max(0, elapsedMs) * speed);
}

export function countCiphertextWords(ciphertext: string): number {
  return [...ciphertext.matchAll(WORD_PATTERN)].length;
}

// Split ciphertext into lines of alternating plain and word spans. Each word span
// carries the running `wordIndex` used to look up its decode candidate and state.
export function tokenizeLines(value: string): TextLine[] {
  let wordIndex = 0;
  return value.split("\n").map((line, key) => {
    const spans: TextSpan[] = [];
    let cursor = 0;
    for (const match of line.matchAll(WORD_PATTERN)) {
      const index = match.index;
      if (index > cursor) spans.push({ surface: line.slice(cursor, index) });
      spans.push({ surface: match[0], wordIndex });
      wordIndex += 1;
      cursor = index + match[0].length;
    }
    if (cursor < line.length) spans.push({ surface: line.slice(cursor) });
    return { key, spans };
  });
}

export function decodeStateName(code: number): DecodeWordState {
  return STATE_NAMES[code] ?? "unchanged";
}

export interface MapWord {
  wordIndex: number;
  length: number;
}

export interface MapLine {
  words: readonly MapWord[];
}

export interface MapLayout {
  lines: readonly MapLine[];
  wordCount: number;
}

// One row per source line (blank lines included, so paragraph gaps survive) with
// each word's running index and character length — enough to lay the whole text
// out in the minimap without re-tokenizing.
export function buildMapLayout(ciphertext: string): MapLayout {
  const lines = tokenizeLines(ciphertext).map((line) => ({
    words: line.spans.flatMap((span) =>
      span.wordIndex === undefined
        ? []
        : [{ wordIndex: span.wordIndex, length: span.surface.length }],
    ),
  }));
  return { lines, wordCount: countCiphertextWords(ciphertext) };
}

// Canvas mirror of the manuscript ink palette (styles.css --fresh/--ink/--regress
// /--amber). Kept here so the minimap and the rendered text stay in visual sync.
export const MAP_COLORS = {
  ciphered: "rgba(32, 33, 28, 0.22)",
  fresh: "#2f6d3a",
  ink: "#20211c",
  regress: "#a5453a",
  amber: "#b98a2e",
} as const;

export function stateColor(state: number, hasCandidate: boolean): string {
  switch (state) {
    case STATE_CODES["newly-correct"]:
      return MAP_COLORS.fresh;
    case STATE_CODES.regressed:
      return MAP_COLORS.regress;
    case STATE_CODES["changed-incorrect"]:
      return MAP_COLORS.amber;
    case STATE_CODES["previously-correct"]:
      return MAP_COLORS.ink;
    default:
      // unchanged: resolved-to-same reads as ink, still-ciphered reads faint.
      return hasCandidate ? MAP_COLORS.ink : MAP_COLORS.ciphered;
  }
}

function emptyCandidates(wordCount: number): (string | null | undefined)[] {
  return Array.from({ length: wordCount }, () => undefined);
}

export function appendDecodeCheckpoint(
  snapshots: readonly DecodeSnapshot[],
  checkpoint: DecodeCheckpoint,
  wordCount: number,
): readonly DecodeSnapshot[] {
  if (snapshots.some((snapshot) => snapshot.checkpoint.checkpointId === checkpoint.checkpointId)) {
    return snapshots;
  }
  const previous = snapshots.findLast(
    (snapshot) => snapshot.checkpoint.originId === checkpoint.originId,
  );
  if (previous !== undefined && checkpoint.atMs < previous.checkpoint.atMs) {
    throw new Error(`Decode checkpoint ${checkpoint.checkpointId} arrived out of order.`);
  }
  if (checkpoint.status === "failed") {
    return [
      ...snapshots,
      {
        checkpoint,
        candidates: previous?.candidates ?? emptyCandidates(wordCount),
        states: previous?.states ?? new Uint8Array(wordCount),
      },
    ];
  }
  const candidates = previous === undefined ? emptyCandidates(wordCount) : [...previous.candidates];
  const states = previous?.states.slice() ?? new Uint8Array(wordCount);
  for (let index = 0; index < states.length; index += 1) {
    states[index] = states[index] === 1 || states[index] === 2 ? 2 : 0;
  }
  for (const delta of checkpoint.deltas ?? []) {
    if (delta.index >= wordCount) {
      throw new Error(`Decode checkpoint ${checkpoint.checkpointId} exceeds the ciphertext.`);
    }
    candidates[delta.index] = delta.candidate;
    states[delta.index] = STATE_CODES[delta.state];
  }
  return [...snapshots, { checkpoint, candidates, states }];
}
