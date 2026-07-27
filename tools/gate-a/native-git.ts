import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  VisibilityJournal,
  buildLogicalTransaction,
  encodeGitAccountingFrame,
  refOperations,
} from "@palimpsest/git-accounting";

const execFileAsync = promisify(execFile);
const deterministicEnvironment = {
  ...process.env,
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: deterministicEnvironment,
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.trim();
}

function gitWithInput(repository: string, args: string[], input: Buffer | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repository, ...args], {
      env: deterministicEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(
          new Error(
            `Git command failed (${String(code)}): git ${args.join(" ")}\n${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}

export interface NativeGitFixture {
  firstTip: string;
  repository: string;
  tip: string;
}

export async function createNativeGitFixture(): Promise<NativeGitFixture> {
  const repository = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-git-"));
  await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", repository], {
    env: deterministicEnvironment,
  });
  await git(repository, ["config", "user.name", "Palimpsest Evidence"]);
  await git(repository, ["config", "user.email", "evidence@palimpsest.invalid"]);
  await writeFile(join(repository, "belief.txt"), "mapping alpha -> w0001\n");
  await git(repository, ["add", "belief.txt"]);
  await git(repository, ["commit", "--quiet", "-m", "checkpoint one"]);
  const firstTip = await git(repository, ["rev-parse", "HEAD"]);
  await writeFile(
    join(repository, "belief.txt"),
    "mapping alpha -> w0001\ncontradiction beta != w0002\n",
  );
  await git(repository, ["add", "belief.txt"]);
  await git(repository, ["commit", "--quiet", "-m", "checkpoint two"]);
  return { firstTip, repository, tip: await git(repository, ["rev-parse", "HEAD"]) };
}

export interface PackProfileResult {
  frame: Buffer;
  frameSha256Input: Buffer;
  profileId: string;
}

const packProfiles = [
  {
    args: ["repack", "-adf", "--window=0", "--depth=0"],
    config: ["pack.compression", "0"],
    profileId: "undeltified-compression-0",
  },
  {
    args: ["repack", "-adf", "--window=10", "--depth=10"],
    config: ["pack.compression", "1"],
    profileId: "shallow-delta-compression-1",
  },
  {
    args: ["repack", "-adf", "--window=50", "--depth=50"],
    config: ["pack.compression", "9"],
    profileId: "deep-delta-compression-9",
  },
] as const;

async function currentFrame(fixture: NativeGitFixture): Promise<Buffer> {
  const transaction = await buildLogicalTransaction({
    authenticatedAgent: 1,
    newOid: fixture.tip,
    operation: refOperations.create,
    publicationSlot: 0,
    refName: "refs/heads/agents/agent-1/work",
    repository: fixture.repository,
    slotStartJournal: new VisibilityJournal(),
  });
  return encodeGitAccountingFrame(transaction);
}

export async function framesAcrossPackProfiles(
  fixture: NativeGitFixture,
): Promise<PackProfileResult[]> {
  const loose = await currentFrame(fixture);
  const results: PackProfileResult[] = [
    { frame: loose, frameSha256Input: loose, profileId: "loose" },
  ];
  for (const profile of packProfiles) {
    await git(fixture.repository, ["config", profile.config[0], profile.config[1]]);
    await git(fixture.repository, [...profile.args]);
    const frame = await currentFrame(fixture);
    results.push({ frame, frameSha256Input: frame, profileId: profile.profileId });
  }
  const clone = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-clone-"));
  await rm(clone, { recursive: true });
  try {
    await execFileAsync("git", ["clone", "--quiet", "--no-local", fixture.repository, clone], {
      env: deterministicEnvironment,
    });
    results.push({
      frame: await currentFrame({ ...fixture, repository: clone }),
      frameSha256Input: loose,
      profileId: "supported-client-clone",
    });
  } finally {
    await rm(clone, { force: true, recursive: true });
  }

  const thinReceiver = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-thin-"));
  try {
    await execFileAsync("git", ["init", "--quiet", "--object-format=sha256", thinReceiver], {
      env: deterministicEnvironment,
    });
    await git(thinReceiver, ["fetch", "--quiet", fixture.repository, fixture.firstTip]);
    const thinPack = await gitWithInput(
      fixture.repository,
      ["pack-objects", "--stdout", "--thin", "--revs"],
      `${fixture.tip}\n^${fixture.firstTip}\n`,
    );
    await gitWithInput(thinReceiver, ["index-pack", "--stdin", "--fix-thin"], thinPack);
    results.push({
      frame: await currentFrame({ ...fixture, repository: thinReceiver }),
      frameSha256Input: loose,
      profileId: "thin-pack-receiver",
    });
  } finally {
    await rm(thinReceiver, { force: true, recursive: true });
  }
  return results;
}
