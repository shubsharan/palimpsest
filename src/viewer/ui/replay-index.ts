import type {
  DecodeCheckpoint,
  DecodeWordState,
  ViewerEvent,
  ViewerEventCategory,
  ViewerRun,
  ViewerToolCall,
} from "../contracts.js";

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
  return [...ciphertext.matchAll(/\p{L}+(?:['\u2019]\p{L}+)*/gu)].length;
}

export function decodeStateName(code: number): DecodeWordState {
  return STATE_NAMES[code] ?? "unchanged";
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
