import { buildPuzzleFromFlags, buildSandbox } from "./build.js";
import { evaluatePuzzleFromFlags } from "./evaluate.js";
import { parseFlags } from "./flags.js";
import { runOfflinePuzzleFromFlags } from "./offline.js";
import { runPreflight } from "./preflight.js";
import { runPuzzleFromFlags } from "./run.js";

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
    result = await runPuzzleFromFlags(flags);
    break;
  case "evaluate":
    result = await evaluatePuzzleFromFlags(flags);
    break;
  case "offline":
    result = await runOfflinePuzzleFromFlags(flags);
    break;
  case "preflight":
    result = await runPreflight();
    break;
  default:
    throw new Error(
      `Unknown puzzle command ${command === undefined ? "(missing)" : JSON.stringify(command)}.`,
    );
}

process.stdout.write(`${JSON.stringify(result)}\n`);
