import { buildFixtureFromFlags, buildSandbox } from "./fixture/build.js";
import { analyzeRunFromFlags } from "./evaluation/overlap.js";
import { evaluateRunFromFlags } from "./evaluation/evaluator.js";
import { runExperimentFromFlags, validateExperimentFromFlags } from "./experiment/execution.js";
import { parseFlags } from "./flags.js";

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
    result = await runExperimentFromFlags(flags);
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
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

process.stdout.write(`${JSON.stringify(result)}\n`);
