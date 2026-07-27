import { readFile, writeFile } from "node:fs/promises";

import { canonicalArchiveBytes, sha256Hex } from "@palimpsest/contracts";

const fixturesRoot = new URL("../../packages/contracts/fixtures/", import.meta.url);

for (const name of ["archive-empty", "archive-files"]) {
  const input = JSON.parse(await readFile(new URL(`valid/${name}.json`, fixturesRoot), "utf8"));
  const bytes = canonicalArchiveBytes(input);
  await writeFile(new URL(`golden/${name}.tar`, fixturesRoot), bytes);
  process.stdout.write(`${name}: ${bytes.length} bytes, sha256 ${sha256Hex(bytes)}\n`);
}
