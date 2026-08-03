import { buildFixtureFromFlags, buildSandbox } from "./fixture/build.js";
import { analyzeRunFromFlags } from "./evaluation/overlap.js";
import { evaluateRunFromFlags } from "./evaluation/evaluator.js";
import { runExperimentFromFlags, validateExperimentFromFlags } from "./experiment/execution.js";
import { isExperimentWorker, superviseExperiment } from "./experiment/supervisor.js";
import { parseFlags } from "./flags.js";
import { runViewerFromFlags } from "./viewer/server.js";

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
  case "validate":
    result = await validateExperimentFromFlags(flags);
    break;
  case "evaluate":
    result = await evaluateRunFromFlags(flags);
    break;
  case "analyze":
    result = await analyzeRunFromFlags(flags);
    break;
  case "view":
    await runViewerFromFlags(flags);
    break;
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
