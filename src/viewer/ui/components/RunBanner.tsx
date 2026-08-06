import { memo, useState } from "react";

import type { ViewerRun } from "../../contracts.js";
import { RunDossier } from "./RunDossier.js";

// A single quiet line — the headline number and per-origin detail live in the
// manuscript readout and the dossier, so the banner only notes the graded result.
function outcomeNote(run: ViewerRun): string {
  const scores = run.finalScores;
  if (scores.length === 0) return "not graded";
  if (scores.length === 1) return `graded · ${Math.round(scores[0]!.accuracy * 100)}%`;
  return `${scores.length} origins graded`;
}

export const RunBanner = memo(function RunBanner({ run }: { run: ViewerRun }) {
  const [dossierOpen, setDossierOpen] = useState(false);
  return (
    <header className="run-banner">
      <div className="banner-main">
        <div className="banner-title">
          <h1>{run.runId}</h1>
          <p className="treatment">{run.treatmentSummary}</p>
        </div>
        <div className="outcome">
          <span className="outcome-note">{outcomeNote(run)}</span>
          <button
            type="button"
            className="dossier-toggle"
            aria-expanded={dossierOpen}
            onClick={() => setDossierOpen((open) => !open)}
          >
            {dossierOpen ? "hide dossier" : "dossier"}
          </button>
        </div>
      </div>
      {dossierOpen ? <RunDossier run={run} /> : null}
    </header>
  );
});
