import { startTransition, useEffect, useRef, useState } from "react";

import type { DecodeStreamEvent, ViewerRun } from "../../contracts.js";
import {
  appendDecodeCheckpoint,
  countCiphertextWords,
  type DecodeSnapshot,
} from "../replay-index.js";

export interface DecodeStreamState {
  snapshots: readonly DecodeSnapshot[];
  // "preparing" | "complete" | any error message surfaced by the stream.
  replayStatus: string;
}

// Subscribes to the decode checkpoint stream for a loaded run and folds each
// checkpoint into a compact snapshot. Snapshot updates are low priority: they
// should never delay the playhead, so they are committed inside a transition.
export function useDecodeStream(run: ViewerRun | undefined): DecodeStreamState {
  const [snapshots, setSnapshots] = useState<readonly DecodeSnapshot[]>([]);
  const snapshotsRef = useRef<readonly DecodeSnapshot[]>([]);
  const [replayStatus, setReplayStatus] = useState("preparing");

  useEffect(() => {
    if (run === undefined) return;
    const wordCount = countCiphertextWords(run.ciphertext);
    const source = new EventSource("/api/decode/events");
    source.addEventListener("replay", (rawEvent) => {
      const event = JSON.parse((rawEvent as MessageEvent<string>).data) as DecodeStreamEvent;
      if (event.type === "checkpoint") {
        try {
          const next = appendDecodeCheckpoint(snapshotsRef.current, event.checkpoint, wordCount);
          snapshotsRef.current = next;
          startTransition(() => setSnapshots(next));
        } catch (error) {
          setReplayStatus(error instanceof Error ? error.message : String(error));
          source.close();
        }
      } else if (event.type === "complete") {
        setReplayStatus("complete");
        source.close();
      } else if (event.type === "failed") {
        setReplayStatus(event.error);
        source.close();
      }
    });
    source.onerror = () => {
      setReplayStatus((current) =>
        current === "complete" ? current : "Replay stream interrupted.",
      );
    };
    return () => source.close();
  }, [run]);

  return { snapshots, replayStatus };
}
