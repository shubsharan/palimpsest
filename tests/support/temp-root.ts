import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function makeRemovable(path: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const child of await readdir(path)) await makeRemovable(join(path, child));
    return;
  }
  await chmod(path, 0o600);
}

export async function removeTestRoot(path: string): Promise<void> {
  await makeRemovable(path);
  await rm(path, { recursive: true, force: true });
}
