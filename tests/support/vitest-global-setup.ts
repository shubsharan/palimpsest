import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTestRoot } from "./temp-root.js";

export default function setup(): () => Promise<void> {
  const previous = {
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
  const root = mkdtempSync(join(tmpdir(), "palimpsest-vitest-"));
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;

  return async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await removeTestRoot(root);
  };
}
