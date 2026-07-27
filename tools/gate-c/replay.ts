import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function replayGateC(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.gate_c.replay",
      ...args,
    ],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await replayGateC(process.argv.slice(2))}\n`);
}
