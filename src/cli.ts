import { buildPuzzleFromFlags, buildSandbox } from "./build.js";
import { runConfiguredPuzzleFromFlags } from "./configured-run.js";
import { evaluatePuzzleFromFlags } from "./evaluate.js";
import { runExperimentFromFlags } from "./experiment.js";
import { parseFlags } from "./flags.js";
import { runOfflinePuzzleFromFlags } from "./offline.js";

const [command, ...args] = process.argv.slice(2);
const flags = parseFlags(args);

let result: unknown;
switch (command) {
  case "sandbox-build":
    result = await buildSandbox();
    break;
  case "build":
    result = await buildPuzzleFromFlags(flags);
    break;
  case "run":
    result = await runConfiguredPuzzleFromFlags(flags);
    break;
  case "experiment":
    result = await runExperimentFromFlags(flags);
    break;
  case "evaluate":
    result = await evaluatePuzzleFromFlags(flags);
    break;
  case "offline":
    result = await runOfflinePuzzleFromFlags(flags);
    break;
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

process.stdout.write(`${JSON.stringify(result)}\n`);
