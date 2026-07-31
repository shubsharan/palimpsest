import { buildFixtureFromFlags, buildSandbox } from "./build.js";
import { evaluateRunFromFlags } from "./evaluate.js";
import { runExperimentFromFlags, validateExperimentFromFlags } from "./experiment.js";
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
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

process.stdout.write(`${JSON.stringify(result)}\n`);
