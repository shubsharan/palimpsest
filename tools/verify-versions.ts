import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const EXPECTED_TOOL_VERSIONS = {
  docker: "29.6.2",
  git: "2.48.1",
  node: "26.5.0",
  pnpm: "10.14.0",
  python: "3.12.4",
  uv: "0.11.14",
} as const;

export type ToolVersionMap = Record<keyof typeof EXPECTED_TOOL_VERSIONS, string>;

async function commandVersion(command: string, args: string[], prefix: RegExp): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return stdout.trim().replace(prefix, "");
}

export async function readActualToolVersions(): Promise<ToolVersionMap> {
  const [docker, pnpm, python, uv, git] = await Promise.all([
    commandVersion("docker", ["version", "--format", "{{.Client.Version}}"], /^/),
    commandVersion("pnpm", ["--version"], /^/),
    commandVersion("python3", ["--version"], /^Python\s+/),
    commandVersion("uv", ["--version"], /^uv\s+/),
    commandVersion("git", ["--version"], /^git version\s+/),
  ]);
  return {
    docker,
    git,
    node: process.versions.node,
    pnpm,
    python,
    uv: uv.split(/\s+/)[0] ?? uv,
  };
}

export function verifyVersionMap(actual: ToolVersionMap): void {
  for (const [tool, expected] of Object.entries(EXPECTED_TOOL_VERSIONS)) {
    const received = actual[tool as keyof ToolVersionMap];
    if (received !== expected) {
      throw new Error(`${tool}: expected ${expected}, received ${received}`);
    }
  }
}

function parseToolVersions(source: string): ToolVersionMap {
  const entries = Object.fromEntries(
    source
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/, 2)),
  );
  return entries as ToolVersionMap;
}

export async function verifyDeclaredPins(): Promise<void> {
  const [toolVersions, nodeVersion, pythonVersion, packageSource, pyproject] = await Promise.all([
    readFile(".tool-versions", "utf8"),
    readFile(".node-version", "utf8"),
    readFile(".python-version", "utf8"),
    readFile("package.json", "utf8"),
    readFile("python/pyproject.toml", "utf8"),
  ]);
  verifyVersionMap(parseToolVersions(toolVersions));
  const packageManifest = JSON.parse(packageSource);
  if (
    nodeVersion.trim() !== EXPECTED_TOOL_VERSIONS.node ||
    pythonVersion.trim() !== EXPECTED_TOOL_VERSIONS.python ||
    packageManifest.packageManager !== `pnpm@${EXPECTED_TOOL_VERSIONS.pnpm}` ||
    packageManifest.engines?.node !== EXPECTED_TOOL_VERSIONS.node ||
    packageManifest.engines?.pnpm !== EXPECTED_TOOL_VERSIONS.pnpm ||
    !pyproject.includes(`requires-python = "==${EXPECTED_TOOL_VERSIONS.python}"`)
  ) {
    throw new Error("One or more repository tool declarations differ from .tool-versions.");
  }
}

async function main(): Promise<void> {
  await verifyDeclaredPins();
  const actual = await readActualToolVersions();
  verifyVersionMap(actual);
  process.stdout.write(
    `Pinned toolchain verified: ${Object.entries(actual)
      .map(([name, version]) => `${name} ${version}`)
      .join(", ")}.\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
