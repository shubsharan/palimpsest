import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function releaseAgentShard(options: {
  bundleRoot: string;
  agentId: string;
  destination: string;
  ordinal: number;
}): Promise<string> {
  const { bundleRoot, agentId, destination, ordinal } = options;
  if (ordinal < 1 || ordinal > 2) {
    throw new Error("Offline fixture release ordinal must be 1 or 2.");
  }
  const source = join(bundleRoot, "private", agentId);
  const releaseRoot = join(destination, "released");
  await mkdir(releaseRoot, { recursive: true });
  await cp(join(source, "shard-manifest.json"), join(releaseRoot, "shard-manifest.json"));
  await cp(
    join(source, "releases", String(ordinal).padStart(2, "0"), "manifest.json"),
    join(releaseRoot, "release-manifest.json"),
  );
  const chapter = (9 + (Number(agentId.at(-1)) - 1) * 2 + ordinal).toString().padStart(3, "0");
  await cp(join(source, "chapters", `${chapter}.txt`), join(releaseRoot, `${chapter}.txt`));
  return join(releaseRoot, "release-manifest.json");
}
