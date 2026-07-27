import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import { buildHarnessBundle } from "./build.js";
import { gradeAttempt } from "./grade.js";
import { verifyHarnessInputs } from "./inputs.js";
import { replayAttempt } from "./replay.js";
import { completeAttempt, writePredeclaration } from "./report.js";
import { runOfflineHarness } from "./run.js";

export async function runComposedOfflineHarness(
  root = ".",
): Promise<Record<string, unknown>> {
  await verifyHarnessInputs(root);
  await buildHarnessBundle(root);
  await writePredeclaration(root);
  const identity = await runOfflineHarness({
    root,
    runId: `offline-${Date.now().toString(36)}`,
  });
  await gradeAttempt(identity, root);
  await replayAttempt(identity, root);
  return completeAttempt(identity, root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await runComposedOfflineHarness()).toString("utf8")}\n`,
  );
}
