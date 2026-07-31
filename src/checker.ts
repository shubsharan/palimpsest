import { runPythonJson } from "./python.js";
import type { CheckerHook } from "./tools.js";

export function createChecker(root: string, fixtureRoot: string, variantId: string): CheckerHook {
  return async (request) => {
    if (request.releasedStages.length === 0) {
      return { matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 };
    }
    return runPythonJson(
      root,
      "palimpsest.evaluation.checker",
      [
        "--fixture",
        fixtureRoot,
        "--variant",
        variantId,
        "--agent",
        request.agentId,
        "--released",
        request.releasedStages.join(","),
        "--candidate",
        request.candidatePath,
      ],
      request.signal,
    ) as Promise<
      | { matchedWords: number; totalWords: number; coverage: number; accuracy: number }
      | { error: string }
    >;
  };
}
