import { readFile } from "node:fs/promises";

import { sha256Hex } from "@palimpsest/contracts";
import { describe, expect, test } from "vitest";

import {
  AGENT_IDS,
  CLEAN_SOLVER_IMAGE_TAG,
  CONTAINER_BASE_IMAGE,
  FIXTURE_IMAGE_TAG,
  GIT_GATEWAY_IMAGE_TAG,
  RETAINED_COMMUNICATION_BUDGET_BYTES,
} from "../../tools/harness/config.js";
import {
  validateAgentNetworkTopology,
  verifyAuthenticationIsolationProbe,
} from "../../tools/harness/container-runtime.js";
import { validAgentNetworkIsolationEvidence } from "../../tools/harness/report.js";

const dockerId = (digit: string) => digit.repeat(64);

function inspectedTopology() {
  const gatewayContainerId = dockerId("a");
  const agentContainers = {
    "agent-1": dockerId("1"),
    "agent-2": dockerId("2"),
    "agent-3": dockerId("3"),
  };
  const agentNetworkNames = {
    "agent-1": "palimpsest-run-agent-1",
    "agent-2": "palimpsest-run-agent-2",
    "agent-3": "palimpsest-run-agent-3",
  };
  const networkIds = {
    "agent-1": dockerId("4"),
    "agent-2": dockerId("5"),
    "agent-3": dockerId("6"),
  };
  return {
    gatewayContainerId,
    agentContainers,
    agentNetworkNames,
    networks: AGENT_IDS.map((agentId) => ({
      name: agentNetworkNames[agentId],
      id: networkIds[agentId],
      internal: true,
      memberContainerIds: [gatewayContainerId, agentContainers[agentId]],
    })),
    containerNetworks: [
      {
        containerId: gatewayContainerId,
        networkIds: AGENT_IDS.map((agentId) => networkIds[agentId]),
      },
      ...AGENT_IDS.map((agentId) => ({
        containerId: agentContainers[agentId],
        networkIds: [networkIds[agentId]],
      })),
    ],
  };
}

describe("container isolation declarations", () => {
  test("pins image content, immutable bases, packages, and non-root users", async () => {
    expect(CONTAINER_BASE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(FIXTURE_IMAGE_TAG).toBe("palimpsest-fixture-agent:0.1.0");
    expect(GIT_GATEWAY_IMAGE_TAG).toBe("palimpsest-git-gateway:0.1.0");
    expect(CLEAN_SOLVER_IMAGE_TAG).toBe("palimpsest-clean-solver:0.1.0");
    const fixture = await readFile("containers/fixture-agent/Dockerfile", "utf8");
    const gateway = await readFile("containers/git-gateway/Dockerfile", "utf8");
    const solver = await readFile("containers/clean-solver/Dockerfile", "utf8");
    const lock = JSON.parse(await readFile("containers/images.lock.json", "utf8"));
    expect(lock.baseImage).toBe(CONTAINER_BASE_IMAGE);
    expect(lock.fixtureAgent).toMatchObject({
      tag: FIXTURE_IMAGE_TAG,
      dockerfileSha256: sha256Hex(Buffer.from(fixture)),
    });
    expect(lock.cleanSolver).toMatchObject({
      tag: CLEAN_SOLVER_IMAGE_TAG,
      dockerfileSha256: sha256Hex(Buffer.from(solver)),
    });
    for (const dockerfile of [fixture, gateway, solver]) {
      expect(dockerfile).toContain(CONTAINER_BASE_IMAGE);
      expect(dockerfile).toMatch(/\nUSER [1-9]/);
    }
    expect(fixture).toContain("pnpm install --frozen-lockfile");
    expect(fixture).not.toContain("git-server-container.ts");
    expect(gateway).toContain("git-server-container.ts");
    expect(gateway).not.toContain("fixture-worker.ts");
    expect(solver).not.toContain("COPY ");
  });

  test("keeps credentials, source material, and oracle data outside image builds", async () => {
    const source = [
      await readFile("containers/fixture-agent/Dockerfile", "utf8"),
      await readFile("containers/git-gateway/Dockerfile", "utf8"),
      await readFile("containers/clean-solver/Dockerfile", "utf8"),
    ].join("\n");
    expect(source).not.toMatch(
      /OPENAI_API_KEY|\.env|artifacts\/|docs\/|sealed\/|prepared\.txt|oracle|private\//i,
    );
    const runtimeSources = [
      await readFile("tools/harness/container-runtime.ts", "utf8"),
      await readFile("tools/harness/git-server-container.ts", "utf8"),
      await readFile("tools/harness/run.ts", "utf8"),
    ].join("\n");
    expect(runtimeSources).not.toMatch(/fixture-agent-[123]/);
    expect(runtimeSources).toContain("randomBytes(GIT_SECRET_ENTROPY_BYTES)");
    expect(runtimeSources).toContain('"--env-file"');
    expect(runtimeSources).not.toMatch(/http:\/\/[^/\\s]+:[^@\\s]+@git-gateway/);
  });

  test("requires own-path access and rejects cross-path and wrong-secret access", () => {
    expect(() =>
      verifyAuthenticationIsolationProbe(JSON.stringify({ own: 200, cross: 401, wrong: 401 })),
    ).not.toThrow();
    expect(() =>
      verifyAuthenticationIsolationProbe(JSON.stringify({ own: 200, cross: 200, wrong: 401 })),
    ).toThrow("Git authentication isolation probe failed.");
    expect(() =>
      verifyAuthenticationIsolationProbe(JSON.stringify({ own: 401, cross: 401, wrong: 200 })),
    ).toThrow("Git authentication isolation probe failed.");
  });

  test("declares least-privilege mounts, capabilities, users, and networks", async () => {
    const runtime = await readFile("tools/harness/container-runtime.ts", "utf8");
    const run = await readFile("tools/harness/run.ts", "utf8");
    const solver = await readFile("python/src/palimpsest/solver/executor.py", "utf8");
    for (const source of [runtime, run, solver]) {
      expect(source).toContain('"--read-only"');
      expect(source).toContain('"--cap-drop"');
      expect(source).toContain('"no-new-privileges"');
      expect(source).toContain('"--pids-limit"');
      expect(source).toContain('"--memory"');
      expect(source).toContain('"--cpus"');
    }
    expect(runtime).toContain('"--internal"');
    expect(runtime).toContain('"--user"');
    expect(run).toContain("containerRuntime.agentNetwork(agentId)");
    expect(run).not.toContain("containerRuntime.network");
    expect(run).toContain(":/request/invocation.json:ro");
    expect(run).toContain(":/input:ro");
    expect(run).toContain(":/workspace:rw");
    expect(run).toContain(":/output:rw");
    expect(run).not.toContain("sealed/prepared.txt");
    expect(solver).toContain('"none"');
    expect(solver).toContain(":/submission/solver.sh:ro");
    expect(solver).toContain(":/input:ro");
    expect(solver).toContain(":/output:rw");
  });

  test("uses the retained Gate A communication ceiling everywhere", async () => {
    expect(RETAINED_COMMUNICATION_BUDGET_BYTES).toBe(38_912);
    const runtime = await readFile("tools/harness/container-runtime.ts", "utf8");
    const run = await readFile("tools/harness/run.ts", "utf8");
    const report = await readFile("tools/harness/report.ts", "utf8");
    const instance = await readFile("python/src/palimpsest/instance_pipeline/instance.py", "utf8");
    for (const source of [runtime, run, report]) {
      expect(source).toContain("RETAINED_COMMUNICATION_BUDGET_BYTES");
      expect(source).not.toMatch(/65_?536/);
    }
    expect(instance).toContain('"communicationBudgetBytes": 38_912');
    expect(instance).not.toMatch(/65_?536/);
  });

  test("accepts only three inspected internal bridges with no lateral agent membership", () => {
    const topology = inspectedTopology();
    const evidence = validateAgentNetworkTopology(topology);
    expect(validAgentNetworkIsolationEvidence(evidence)).toBe(true);
    expect(evidence.agents).toHaveLength(3);
    expect(evidence.agents.every((agent) => agent.memberContainerIds.length === 2)).toBe(true);

    const sharedAgentNetwork = structuredClone(topology);
    sharedAgentNetwork.networks[0]!.memberContainerIds.push(
      sharedAgentNetwork.agentContainers["agent-2"],
    );
    expect(() => validateAgentNetworkTopology(sharedAgentNetwork)).toThrow(
      "agent-1 is not isolated",
    );

    const externalNetwork = structuredClone(topology);
    externalNetwork.networks[1]!.internal = false;
    expect(() => validateAgentNetworkTopology(externalNetwork)).toThrow(
      "distinct internal Docker networks",
    );

    const uninspectedConnection = structuredClone(topology);
    uninspectedConnection.containerNetworks[2]!.networkIds.push(dockerId("7"));
    expect(() => validateAgentNetworkTopology(uninspectedConnection)).toThrow(
      "agent-2 is not isolated",
    );

    const forgedCompletionEvidence = structuredClone(evidence);
    forgedCompletionEvidence.agents[2]!.memberContainerIds.push(
      forgedCompletionEvidence.agents[0]!.containerId,
    );
    expect(validAgentNetworkIsolationEvidence(forgedCompletionEvidence)).toBe(false);
  });
});
