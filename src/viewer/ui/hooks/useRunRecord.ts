import { useEffect, useState } from "react";

import type { ViewerRun } from "../../contracts.js";

export interface RunRecordState {
  run: ViewerRun | undefined;
  loadError: string | undefined;
}

// Loads the immutable run record once. The record never changes after a run is
// frozen, so there is nothing to refetch or invalidate.
export function useRunRecord(): RunRecordState {
  const [run, setRun] = useState<ViewerRun>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/run", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Viewer API returned ${String(response.status)}.`);
        setRun((await response.json()) as ViewerRun);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  return { run, loadError };
}
