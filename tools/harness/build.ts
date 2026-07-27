import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import { HARNESS_ROOT } from "./config.js";
import { preflightBundle } from "./preflight.js";

const execFileAsync = promisify(execFile);

async function filePaths(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const name of (await readdir(current)).sort()) {
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      paths.push(...(await filePaths(root, path)));
    } else if (metadata.isFile()) {
      paths.push(relative(root, path).split(sep).join("/"));
    }
  }
  return paths.sort();
}

async function assertSameTree(left: string, right: string): Promise<void> {
  const leftPaths = await filePaths(left);
  const rightPaths = await filePaths(right);
  if (canonicalJsonBytes(leftPaths).compare(canonicalJsonBytes(rightPaths)) !== 0) {
    throw new Error("Repeated instance build changed the output path set.");
  }
  for (const path of leftPaths) {
    const [leftBytes, rightBytes] = await Promise.all([
      readFile(join(left, path)),
      readFile(join(right, path)),
    ]);
    if (!leftBytes.equals(rightBytes)) {
      throw new Error(`Repeated instance build changed bytes: ${path}`);
    }
  }
}

export async function buildHarnessBundle(root = "."): Promise<Record<string, unknown>> {
  const harnessRoot = resolve(root, HARNESS_ROOT);
  const declared = join(harnessRoot, "declared");
  const work = join(harnessRoot, "work", `build-${process.pid}-${randomBytes(4).toString("hex")}`);
  await mkdir(join(harnessRoot, "work"), { recursive: true });
  try {
    await execFileAsync(
      "uv",
      [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.instance_pipeline.bundle",
        "--root",
        resolve(root),
        "--output",
        work,
      ],
      { cwd: resolve(root), maxBuffer: 10 * 1024 * 1024 },
    );
    const manifest = await preflightBundle(work);
    try {
      await stat(declared);
      await assertSameTree(declared, work);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await cp(work, declared, { recursive: true, errorOnExist: true });
      } else {
        throw error;
      }
    }
    await preflightBundle(declared);
    return manifest as unknown as Record<string, unknown>;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildHarnessBundle();
  process.stdout.write(`${canonicalJsonBytes(result).toString("utf8")}\n`);
}
