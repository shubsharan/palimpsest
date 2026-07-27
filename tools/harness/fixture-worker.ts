import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes } from "@palimpsest/contracts";
import type { AgentBridgeEvent, AgentInvocationRequest } from "@palimpsest/run-control";

import { FIXTURE_ADAPTER_ID } from "./config.js";

const execFileAsync = promisify(execFile);

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Fixture worker requires an invocation request path.");
  }
  const request = JSON.parse(await readFile(requestPath, "utf8")) as AgentInvocationRequest;
  if (request.adapterId !== FIXTURE_ADAPTER_ID) {
    throw new Error(`Fixture worker refuses adapter ${request.adapterId}.`);
  }
  let ordinal = 0;
  const emit = (type: string, payload: Record<string, unknown>) => {
    const event: AgentBridgeEvent = {
      schemaVersion: 1,
      runId: request.runId,
      agentId: request.agentId,
      invocationId: request.invocationId,
      ordinal: ++ordinal,
      type,
      payload,
    };
    process.stdout.write(`${canonicalJsonBytes(event).toString("utf8")}\n`);
  };

  emit("tool.started", { tool: "git.clone" });
  const repository = join(request.workspacePath, "repository");
  await mkdir(request.workspacePath, { recursive: true });
  await execFileAsync("git", ["clone", "--quiet", request.gitEndpoint, repository]);
  await git(repository, ["config", "user.name", `Palimpsest ${request.agentId}`]);
  await git(repository, ["config", "user.email", `${request.agentId}@palimpsest.invalid`]);
  await git(repository, ["switch", "--quiet", "-c", `${request.agentId}-work`]);
  emit("git.clone", { repository: "workspace/repository" });

  const release = JSON.parse(await readFile(request.releasedInputManifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  const notesPath = join(repository, "notes", `${request.agentId}.md`);
  await mkdir(dirname(notesPath), { recursive: true });
  await writeFile(
    notesPath,
    [
      `# ${request.agentId} observable work`,
      "",
      `Release: ${JSON.stringify(release)}`,
      "",
      "Hypothesis: the substitution changes once; retain both stable and revised mappings.",
      "",
    ].join("\n"),
  );
  await git(repository, ["add", `notes/${request.agentId}.md`]);
  await git(repository, ["commit", "--quiet", "-m", `${request.agentId} fixture analysis`]);
  const tip = await git(repository, ["rev-parse", "HEAD"]);
  emit("git.commit", { tip });
  await git(repository, ["push", "--quiet", "origin", `HEAD:${request.gitRefNamespace}/work`]);
  emit("git.push", { ref: `${request.gitRefNamespace}/work`, tip });

  await mkdir(request.privateOutputPath, { recursive: true });
  await writeFile(
    join(request.privateOutputPath, "reconstruction.txt"),
    `${request.agentId} produced a deliberately incomplete fixture reconstruction.\n`,
  );
  await writeFile(join(request.privateOutputPath, "mapping.json"), "{}\n");
  await writeFile(
    join(request.privateOutputPath, "hypothesis.json"),
    `${JSON.stringify({ switchDetected: true, confidence: 0.5 })}\n`,
  );
  const solver = join(request.privateOutputPath, "solver.sh");
  await writeFile(
    solver,
    '#!/bin/sh\nset -eu\nmkdir -p "$2"\nprintf "fixture reconstruction\\n" > "$2/reconstruction.txt"\n',
    { mode: 0o755 },
  );
  emit("file.declared", {
    paths: ["hypothesis.json", "mapping.json", "reconstruction.txt", "solver.sh"],
  });
  emit("worker.completed", { classification: "completed", tip });
}

await main();
