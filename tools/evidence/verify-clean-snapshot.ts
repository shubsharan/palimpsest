import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

const execFileAsync = promisify(execFile);
const evidencePath = "artifacts/milestone-1/clean-snapshot.json";
const sourceEvidence = new Set([
  "artifacts/milestone-1/contract-verdicts.json",
  "artifacts/milestone-1/promotion-evidence.json",
]);

function isSourceFile(path: string): boolean {
  if (path.startsWith("artifacts/milestone-1/")) {
    return sourceEvidence.has(path);
  }
  if (path.startsWith("artifacts/gate-a/")) {
    return path.startsWith("artifacts/gate-a/inputs/");
  }
  return true;
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      CI: "true",
      UV_OFFLINE: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function sourceFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: process.cwd(), encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0 && isSourceFile(path))
    .sort();
}

async function main(): Promise<void> {
  const files = await sourceFiles();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-clean-snapshot-"));
  try {
    const fileManifest = [];
    for (const path of files) {
      const metadata = await lstat(path);
      if (!metadata.isFile()) {
        throw new Error(`Clean-snapshot verification only accepts regular source files: ${path}`);
      }
      const bytes = await readFile(path);
      fileManifest.push({
        byteLength: bytes.length,
        path,
        sha256: sha256Hex(bytes),
      });
      const destination = join(temporaryRoot, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(path, destination);
    }
    const sourceDigest = sha256Hex(canonicalJsonBytes(fileManifest));

    await run("git", ["init", "--quiet"], temporaryRoot);
    await run("git", ["config", "user.name", "Palimpsest Evidence"], temporaryRoot);
    await run("git", ["config", "user.email", "evidence@palimpsest.invalid"], temporaryRoot);
    await run("git", ["add", "--all"], temporaryRoot);
    await execFileAsync("git", ["commit", "--quiet", "-m", "Frozen verification snapshot"], {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      },
    });

    await run("pnpm", ["install", "--offline", "--frozen-lockfile"], temporaryRoot);
    await run("uv", ["sync", "--offline", "--frozen", "--project", "python"], temporaryRoot);
    await run("pnpm", ["verify"], temporaryRoot);
    const { stdout: status } = await execFileAsync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    if (status.trim() !== "") {
      throw new Error(`Clean verification changed source-controlled files:\n${status}`);
    }

    const report = {
      schemaVersion: 1,
      milestoneId: "milestone-1-foundation",
      source: {
        digestAlgorithm: "sha256(canonical-json(file-manifest))",
        fileCount: files.length,
        sha256: sourceDigest,
      },
      environment: {
        platform: `${process.platform}-${process.arch}`,
        node: "26.5.0",
        pnpm: "10.14.0",
        python: "3.12.4",
        uv: "0.11.14",
        git: "2.48.1",
      },
      dependencyResolution: "offline-frozen",
      excludedAcquiredInputs: ["artifacts/gate-b/inputs/models/", "artifacts/harness/attempts/"],
      sourceTreeChangesAfterVerification: 0,
      verifiedCommands: [
        "pnpm install --offline --frozen-lockfile",
        "uv sync --offline --frozen --project python",
        "pnpm verify",
      ],
      result: "pass",
    };
    const destination = resolve(evidencePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, canonicalJsonBytes(report));
    process.stdout.write(
      `Wrote ${destination} (${files.length} source files, sha256 ${sourceDigest}).\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
