import { buildFixtureFromFlags, buildSandbox } from "./fixture/build.js";
import { analyzeRunFromFlags } from "./evaluation/overlap.js";
import { evaluateRunFromFlags } from "./evaluation/evaluator.js";
import { runExperimentFromFlags, validateExperimentFromFlags } from "./experiment/execution.js";
import { isExperimentWorker, superviseExperiment } from "./experiment/supervisor.js";
import { parseFlags, requiredFlag } from "./flags.js";
import { gradeRunFromFlags } from "./grading/grade.js";
import { reportRuns } from "./grading/report.js";
import { reviewRun } from "./grading/review.js";

function allowOnly(flags: ReadonlyMap<string, string>, names: readonly string[], command: string) {
  const allowed = new Set(names);
  for (const name of flags.keys()) {
    if (!allowed.has(name)) throw new Error(`${command} does not accept option ${name}.`);
  }
}

const [command, ...args] = process.argv.slice(2);
const flags = parseFlags(args);

let result: unknown;
switch (command) {
  case "sandbox-build":
    if (flags.size > 0) throw new Error("sandbox-build does not accept options.");
    result = await buildSandbox();
    break;
  case "build":
    result = await buildFixtureFromFlags(flags);
    break;
  case "experiment":
    if (!isExperimentWorker()) {
      const exitCode = await superviseExperiment({
        root: process.cwd(),
        flags,
        argv: process.argv.slice(2),
        workerScript: process.argv[1]!,
        execArgv: process.execArgv,
      });
      process.exitCode = exitCode;
      break;
    }
    {
      const controller = new AbortController();
      const interrupt = (signal: NodeJS.Signals) => controller.abort(signal);
      const interruptSignal = () => interrupt("SIGINT");
      const terminateSignal = () => interrupt("SIGTERM");
      process.once("SIGINT", interruptSignal);
      process.once("SIGTERM", terminateSignal);
      try {
        result = await runExperimentFromFlags(flags, undefined, controller.signal);
      } finally {
        process.removeListener("SIGINT", interruptSignal);
        process.removeListener("SIGTERM", terminateSignal);
      }
    }
    break;
  case "grade": {
    const analysis = await gradeRunFromFlags(flags);
    result = {
      runRoot: requiredFlag(flags, "--run-root"),
      analysisId: analysis.analysisId,
      kind: analysis.kind,
      detailsPath: analysis.detailsPath,
      originCount: analysis.origins.length,
    };
    break;
  }
  case "review": {
    allowOnly(
      flags,
      ["--run-root", "--config", "--performance-analysis", "--allow-spend", "--resume"],
      "review",
    );
    const reviewed = await reviewRun({
      projectRoot: process.cwd(),
      runRoot: requiredFlag(flags, "--run-root"),
      configPath: requiredFlag(flags, "--config"),
      performanceAnalysisId: requiredFlag(flags, "--performance-analysis"),
      allowSpend: requiredFlag(flags, "--allow-spend"),
      ...(flags.get("--resume") === undefined ? {} : { resumeAnalysisId: flags.get("--resume")! }),
    });
    result = {
      runRoot: requiredFlag(flags, "--run-root"),
      analysisId: reviewed.analysis.analysisId,
      kind: reviewed.analysis.kind,
      status: reviewed.analysis.status,
      reviewCount: reviewed.analysis.reviews.length,
      detailsPath: reviewed.analysis.detailsPath,
    };
    break;
  }
  case "report": {
    allowOnly(flags, ["--artifacts-root", "--config", "--output"], "report");
    const reported = await reportRuns({
      root: process.cwd(),
      artifactsRoot: requiredFlag(flags, "--artifacts-root"),
      configPath: requiredFlag(flags, "--config"),
      output: requiredFlag(flags, "--output"),
    });
    result = {
      reportId: reported.reportId,
      claimType: reported.claimType,
      includedRunCount: reported.includedRunCount,
      excludedRunCount: reported.excludedRunCount,
      path: reported.path,
    };
    break;
  }
  case "validate":
    result = await validateExperimentFromFlags(flags);
    break;
  case "evaluate":
    result = await evaluateRunFromFlags(flags);
    break;
  case "analyze":
    result = await analyzeRunFromFlags(flags);
    break;
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
