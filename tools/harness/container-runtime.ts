import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  CLEAN_SOLVER_IMAGE_TAG,
  FIXTURE_IMAGE_TAG,
  type HarnessAttemptIdentity,
} from "./config.js";

const execFileAsync = promisify(execFile);

export interface ContainerRuntime {
  network: string;
  gatewayContainer: string;
  fixtureImageId: string;
  solverImageId: string;
  endpoint(agentId: string): string;
  close(): Promise<void>;
}

async function imageId(image: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  const value = stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Docker image has an invalid content identity: ${image}`);
  }
  return value;
}

export async function startContainerRuntime(options: {
  identity: HarnessAttemptIdentity;
  repository: string;
}): Promise<ContainerRuntime> {
  const suffix = options.identity.runId.replaceAll(/[^a-z0-9]/g, "-").slice(0, 40);
  const network = `palimpsest-${suffix}`;
  const gatewayContainer = `${network}-git`;
  const lock = JSON.parse(await readFile("containers/images.lock.json", "utf8"));
  const [fixtureImageId, solverImageId] = await Promise.all([
    imageId(FIXTURE_IMAGE_TAG),
    imageId(CLEAN_SOLVER_IMAGE_TAG),
  ]);
  if (
    fixtureImageId !== lock.fixtureAgent.imageId ||
    solverImageId !== lock.cleanSolver.imageId
  ) {
    throw new Error("Built container image IDs do not match containers/images.lock.json.");
  }
  await execFileAsync("docker", ["network", "create", "--internal", network]);
  try {
    await execFileAsync("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      gatewayContainer,
      "--network",
      network,
      "--network-alias",
      "git-gateway",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--user",
      "0:0",
      "--volume",
      `${options.repository}:/git/repository.git:rw`,
      "--env",
      "PALIMPSEST_GIT_REPOSITORY=/git/repository.git",
      "--entrypoint",
      "node",
      fixtureImageId,
      "--import",
      "tsx",
      "/app/tools/harness/git-server-container.ts",
    ]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { stdout } = await execFileAsync("docker", ["logs", gatewayContainer]);
      if (stdout.includes("ready")) {
        return {
          network,
          gatewayContainer,
          fixtureImageId,
          solverImageId,
          endpoint(agentId) {
            return `http://${agentId}:fixture-${agentId}@git-gateway:8080/${agentId}/repository.git`;
          },
          async close() {
            await execFileAsync("docker", ["rm", "--force", gatewayContainer]);
            await execFileAsync("docker", ["network", "rm", network]);
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Containerized Git Gateway did not become ready.");
  } catch (error) {
    await execFileAsync("docker", ["rm", "--force", gatewayContainer]).catch(() => {});
    await execFileAsync("docker", ["network", "rm", network]).catch(() => {});
    throw error;
  }
}
