import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDockerCommandSandbox,
  SANDBOX_IMAGE_TAG,
  sandboxDockerfileDigest,
} from "../../packages/puzzle-runner/src/index.js";

function buildImage(root: string, sourceDigest: string): Promise<void> {
  return new Promise((resolveBuild, reject) => {
    const child = spawn(
      "docker",
      [
        "build",
        "--tag",
        SANDBOX_IMAGE_TAG,
        "--build-arg",
        `PALIMPSEST_SANDBOX_SOURCE_DIGEST=${sourceDigest}`,
        "containers/puzzle-sandbox",
      ],
      {
        cwd: root,
        stdio: ["ignore", process.stderr, process.stderr],
      },
    );
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal !== null || code !== 0) {
        reject(
          new Error(
            `Docker sandbox build failed${signal === null ? ` with exit ${String(code)}` : ` from ${signal}`}.`,
          ),
        );
        return;
      }
      resolveBuild();
    });
  });
}

export async function buildSandbox(root = resolve(".")) {
  const sourceDigest = await sandboxDockerfileDigest(root);
  await buildImage(root, sourceDigest);
  return (await createDockerCommandSandbox({ root })).identity;
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await buildSandbox())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
