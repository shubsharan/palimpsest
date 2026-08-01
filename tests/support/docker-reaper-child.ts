import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LABEL_TESTCONTAINERS_SESSION_ID,
  getContainerRuntimeClient,
  getReaper,
} from "testcontainers";

import { createDockerCommandSandbox } from "../../src/sandbox/container.js";

async function main(): Promise<void> {
  if (process.send === undefined) throw new Error("Docker reaper child requires an IPC channel.");
  const reaper = await getReaper(await getContainerRuntimeClient());
  const root = await mkdtemp(join(tmpdir(), "palimpsest-reaper-child-"));
  const workspacePath = join(root, "workspace");
  const evidencePath = join(root, "evidence");
  const gitOriginPath = join(root, "origin.git");
  await Promise.all([mkdir(workspacePath), mkdir(evidencePath), mkdir(gitOriginPath)]);
  const sandbox = await createDockerCommandSandbox({
    containerLabels: { [LABEL_TESTCONTAINERS_SESSION_ID]: reaper.sessionId },
    inspectionTimeoutMs: 5_000,
  });
  const lease = await sandbox.openAgentLease({
    profile: "agent",
    workspacePath,
    evidencePath,
    gitOriginPath,
    timeoutMs: 10_000,
  });
  process.send({
    controllerId: sandbox.containerLabelValue,
    root,
    sessionId: reaper.sessionId,
  });
  void lease;
  setInterval(() => undefined, 60_000);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
