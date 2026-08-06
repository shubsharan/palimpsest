import { memo } from "react";

import type { ViewerRun } from "../../contracts.js";
import { formatTime } from "../format.js";

function percent(value: number | undefined): string {
  return value === undefined ? "--" : `${Math.round(value * 100)}%`;
}

// The evaluation outcome for every canonical origin — shared once, or once per
// agent origin in an isolated run. No origin is highlighted or ranked: missing
// publication and unscored solvers are shown as explicit outcomes, per the
// project's "no best result selected" rule.
export const RunDossier = memo(function RunDossier({ run }: { run: ViewerRun }) {
  const scoreByOrigin = new Map(run.finalScores.map((score) => [score.originId, score]));
  return (
    <div className="dossier" role="region" aria-label="Run dossier">
      <section className="dossier-block">
        <h3>Evaluation — every origin, no winner selected</h3>
        <table className="dossier-scores">
          <tbody>
            {run.origins.map((origin) => {
              const score = scoreByOrigin.get(origin.originId);
              return (
                <tr key={origin.originId}>
                  <th scope="row">{origin.originId}</th>
                  {score === undefined ? (
                    <td className="dossier-missing" colSpan={2}>
                      {origin.finalCommit === null ? "no publication" : "not scored"}
                    </td>
                  ) : (
                    <>
                      <td className="dossier-num">
                        {score.matchedWords.toLocaleString()} / {score.totalWords.toLocaleString()}{" "}
                        words
                      </td>
                      <td className="dossier-num">
                        {percent(score.accuracy)} · cov {percent(score.coverage)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="dossier-block">
        <h3>Evidence schedule</h3>
        <ul className="dossier-schedule">
          {run.schedule.releases.map((release) => (
            <li key={release.ordinal} className={release.isRekey ? "is-rekey" : ""}>
              <span className="dossier-when">{formatTime(release.offsetMs)}</span>
              <span>
                drop {release.ordinal}
                {release.isRekey ? " — cipher re-keys" : ""}
              </span>
            </li>
          ))}
          <li className="dossier-cutoff">
            <span className="dossier-when">{formatTime(run.schedule.cutoffMs)}</span>
            <span>cutoff</span>
          </li>
        </ul>
      </section>

      <section className="dossier-block">
        <h3>Agents</h3>
        <ul className="dossier-usage">
          {run.agents.map((agent) => (
            <li key={agent.agentId}>
              <span className="dossier-agent">{agent.agentId}</span>
              <span className="dossier-model">{agent.actualModel ?? agent.requestedModel}</span>
              <span className="dossier-state">{agent.session.state.replace(/-/g, " ")}</span>
              <span className="dossier-num">
                {agent.session.outputTokens.toLocaleString()} out tok
              </span>
            </li>
          ))}
        </ul>
        <p className="dossier-limits">
          {run.tokenLimitPerAgent === null
            ? "No per-agent token limit"
            : `${run.tokenLimitPerAgent.toLocaleString()} token limit / agent`}{" "}
          · spend ceiling ${(run.spendCeilingCents / 100).toFixed(0)}
        </p>
      </section>
    </div>
  );
});
