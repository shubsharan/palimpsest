import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import {
  AGENT_IDS,
  CLEAN_SOLVER_IMAGE_TAG,
  FIXTURE_IMAGE_TAG,
  GIT_GATEWAY_IMAGE_TAG,
  RETAINED_COMMUNICATION_BUDGET_BYTES,
  type HarnessAttemptIdentity,
} from "./config.js";
import {
  gatewayPublicationPaths,
  publicationOrdinal,
  type PublicationRequest,
} from "./publication-slots.js";

const execFileAsync = promisify(execFile);
type AgentId = (typeof AGENT_IDS)[number];
const GIT_SECRET_ENTROPY_BYTES = 32;
const AUTHENTICATION_PROBE_SCRIPT = `
const secret = process.env.PALIMPSEST_GIT_CREDENTIAL;
if (!secret) {
  throw new Error("Authentication probe environment is incomplete.");
}
async function probe(targetAgentId, credential) {
  const authorization = Buffer.from(targetAgentId + ":" + credential, "utf8").toString("base64");
  const path = "/" + targetAgentId +
    "/repository.git/info/refs?service=git-upload-pack";
  const response = await fetch(
    "http://git-gateway:8080" + path,
    { headers: { Authorization: "Basic " + authorization } },
  );
  await response.arrayBuffer();
  return response.status;
}
process.stdout.write(JSON.stringify({
  own: await probe("agent-1", secret),
  cross: await probe("agent-2", secret),
  wrong: await probe("agent-1", secret + "-wrong"),
}));
`;

function createAgentSecrets(): Record<AgentId, string> {
  const secrets = Object.fromEntries(
    AGENT_IDS.map((agentId) => [
      agentId,
      randomBytes(GIT_SECRET_ENTROPY_BYTES).toString("base64url"),
    ]),
  ) as Record<AgentId, string>;
  if (
    Object.values(secrets).some((secret) => !/^[A-Za-z0-9_-]{43}$/.test(secret)) ||
    new Set(Object.values(secrets)).size !== AGENT_IDS.length
  ) {
    throw new Error("Failed to create distinct high-entropy Git credentials.");
  }
  return secrets;
}

export function verifyAuthenticationIsolationProbe(output: string): void {
  const value = JSON.parse(output) as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "cross,own,wrong" ||
    value.own !== 200 ||
    value.cross !== 401 ||
    value.wrong !== 401
  ) {
    throw new Error("Git authentication isolation probe failed.");
  }
}

interface InspectedNetwork {
  name: string;
  id: string;
  internal: boolean;
  memberContainerIds: string[];
}

interface InspectedContainerNetworks {
  containerId: string;
  networkIds: string[];
}

export interface AgentNetworkIsolationEvidence {
  schemaVersion: 1;
  mode: "per-agent-internal-bridges";
  gatewayContainerId: string;
  gatewayNetworkIds: string[];
  agents: Array<{
    agentId: AgentId;
    containerId: string;
    networkName: string;
    networkId: string;
    internal: true;
    memberContainerIds: string[];
  }>;
}

export function validateAgentNetworkTopology(options: {
  gatewayContainerId: string;
  agentContainers: Record<AgentId, string>;
  agentNetworkNames: Record<AgentId, string>;
  networks: InspectedNetwork[];
  containerNetworks: InspectedContainerNetworks[];
}): AgentNetworkIsolationEvidence {
  const containerIdPattern = /^[0-9a-f]{64}$/;
  if (!containerIdPattern.test(options.gatewayContainerId)) {
    throw new Error("Inspected gateway container ID is invalid.");
  }
  const agentContainerIds = AGENT_IDS.map((agentId) => options.agentContainers[agentId]);
  if (
    agentContainerIds.some((containerId) => !containerIdPattern.test(containerId)) ||
    new Set([options.gatewayContainerId, ...agentContainerIds]).size !== AGENT_IDS.length + 1
  ) {
    throw new Error("Inspected agent container IDs must be valid and unique.");
  }

  const expectedNetworkNames = AGENT_IDS.map((agentId) => options.agentNetworkNames[agentId]);
  if (
    options.networks.length !== AGENT_IDS.length ||
    new Set(expectedNetworkNames).size !== AGENT_IDS.length ||
    new Set(options.networks.map((network) => network.name)).size !== AGENT_IDS.length ||
    !options.networks.every((network) => expectedNetworkNames.includes(network.name))
  ) {
    throw new Error("Agent isolation requires exactly one distinct network per agent.");
  }
  if (
    options.networks.some(
      (network) =>
        !containerIdPattern.test(network.id) ||
        network.internal !== true ||
        new Set(network.memberContainerIds).size !== network.memberContainerIds.length,
    ) ||
    new Set(options.networks.map((network) => network.id)).size !== AGENT_IDS.length
  ) {
    throw new Error("Agent isolation networks must be distinct internal Docker networks.");
  }

  const expectedContainerIds = [options.gatewayContainerId, ...agentContainerIds];
  if (
    options.containerNetworks.length !== expectedContainerIds.length ||
    new Set(options.containerNetworks.map((container) => container.containerId)).size !==
      expectedContainerIds.length ||
    !options.containerNetworks.every(
      (container) =>
        expectedContainerIds.includes(container.containerId) &&
        container.networkIds.every((networkId) => containerIdPattern.test(networkId)) &&
        new Set(container.networkIds).size === container.networkIds.length,
    )
  ) {
    throw new Error("Container network inspection is incomplete or contains unexpected members.");
  }

  const networkByName = new Map(options.networks.map((network) => [network.name, network]));
  const networkIds = options.networks.map((network) => network.id).sort();
  const gatewayNetworks = options.containerNetworks.find(
    (container) => container.containerId === options.gatewayContainerId,
  );
  if (
    !gatewayNetworks ||
    canonicalJsonBytes([...gatewayNetworks.networkIds].sort()).compare(
      canonicalJsonBytes(networkIds),
    ) !== 0
  ) {
    throw new Error("The Git gateway must be attached to all and only the agent networks.");
  }

  const agents = AGENT_IDS.map((agentId) => {
    const containerId = options.agentContainers[agentId];
    const networkName = options.agentNetworkNames[agentId];
    const network = networkByName.get(networkName);
    const container = options.containerNetworks.find(
      (candidate) => candidate.containerId === containerId,
    );
    if (!network || !container) {
      throw new Error(`Network inspection is missing for ${agentId}.`);
    }
    const expectedMembers = [options.gatewayContainerId, containerId].sort();
    if (
      canonicalJsonBytes([...network.memberContainerIds].sort()).compare(
        canonicalJsonBytes(expectedMembers),
      ) !== 0 ||
      canonicalJsonBytes([...container.networkIds].sort()).compare(
        canonicalJsonBytes([network.id]),
      ) !== 0
    ) {
      throw new Error(`${agentId} is not isolated to its dedicated gateway network.`);
    }
    return {
      agentId,
      containerId,
      networkName,
      networkId: network.id,
      internal: true as const,
      memberContainerIds: expectedMembers,
    };
  });

  return {
    schemaVersion: 1,
    mode: "per-agent-internal-bridges",
    gatewayContainerId: options.gatewayContainerId,
    gatewayNetworkIds: networkIds,
    agents,
  };
}

export interface ContainerRuntime {
  gatewayContainer: string;
  gatewayImageId: string;
  fixtureImageId: string;
  solverImageId: string;
  agentNetwork(agentId: AgentId): string;
  credentialEnvFile(agentId: AgentId): string;
  endpoint(agentId: string): string;
  inspectAgentIsolation(
    agentContainers: Record<AgentId, string>,
  ): Promise<AgentNetworkIsolationEvidence>;
  closeAdmission(): Promise<void>;
  publishSnapshot(request: PublicationRequest): Promise<Buffer>;
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
  const runtimePrefix = `palimpsest-${suffix}`;
  const agentNetworks = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, `${runtimePrefix}-${agentId}`]),
  ) as Record<AgentId, string>;
  const gatewayContainer = `${runtimePrefix}-git`;
  const lock = JSON.parse(await readFile("containers/images.lock.json", "utf8"));
  const [fixtureImageId, gatewayImageId, solverImageId] = await Promise.all([
    imageId(FIXTURE_IMAGE_TAG),
    imageId(GIT_GATEWAY_IMAGE_TAG),
    imageId(CLEAN_SOLVER_IMAGE_TAG),
  ]);
  if (
    fixtureImageId !== lock.fixtureAgent.imageId ||
    gatewayImageId !== lock.gitGateway.imageId ||
    solverImageId !== lock.cleanSolver.imageId
  ) {
    throw new Error("Built container image IDs do not match containers/images.lock.json.");
  }
  const secretRoot = await mkdtemp(join(tmpdir(), "palimpsest-git-credentials-"));
  try {
    const agentSecrets = createAgentSecrets();
    const agentCredentialFiles = Object.fromEntries(
      await Promise.all(
        AGENT_IDS.map(async (agentId) => {
          const path = join(secretRoot, `${agentId}.env`);
          await writeFile(path, `PALIMPSEST_GIT_CREDENTIAL=${agentSecrets[agentId]}\n`, {
            mode: 0o600,
            flag: "wx",
          });
          return [agentId, path] as const;
        }),
      ),
    ) as Record<AgentId, string>;
    const gatewayCredentialFile = join(secretRoot, "gateway.env");
    await writeFile(
      gatewayCredentialFile,
      `PALIMPSEST_GIT_SECRETS_JSON=${canonicalJsonBytes(agentSecrets).toString("utf8")}\n`,
      { mode: 0o600, flag: "wx" },
    );
    for (const network of Object.values(agentNetworks)) {
      await execFileAsync("docker", ["network", "create", "--internal", network]);
    }
    await execFileAsync("docker", [
      "run",
      "--detach",
      "--name",
      gatewayContainer,
      "--network",
      agentNetworks["agent-1"],
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
      "--tmpfs",
      "/run/palimpsest-hooks:rw,exec,nosuid,nodev,size=1m",
      "--user",
      "0:0",
      "--volume",
      `${options.repository}:/git/repository.git:rw`,
      "--env",
      "PALIMPSEST_GIT_REPOSITORY=/git/repository.git",
      "--env",
      `PALIMPSEST_RUN_ID=${options.identity.runId}`,
      "--env",
      `PALIMPSEST_COMMUNICATION_BUDGET_BYTES=${RETAINED_COMMUNICATION_BUDGET_BYTES}`,
      "--env-file",
      gatewayCredentialFile,
      "--entrypoint",
      "node",
      gatewayImageId,
      "--import",
      "tsx",
      "/app/tools/harness/git-server-container.ts",
    ]);
    for (const agentId of AGENT_IDS.slice(1)) {
      await execFileAsync("docker", [
        "network",
        "connect",
        "--alias",
        "git-gateway",
        agentNetworks[agentId],
        gatewayContainer,
      ]);
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { stdout, stderr } = await execFileAsync("docker", ["logs", gatewayContainer]);
      const logs = `${stdout}${stderr}`;
      if (logs.includes("ready")) {
        const { stdout: authenticationProbe } = await execFileAsync("docker", [
          "run",
          "--rm",
          "--network",
          agentNetworks["agent-1"],
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "32",
          "--memory",
          "64m",
          "--cpus",
          "0.25",
          "--env-file",
          agentCredentialFiles["agent-1"],
          "--entrypoint",
          "node",
          fixtureImageId,
          "--input-type=module",
          "--eval",
          AUTHENTICATION_PROBE_SCRIPT,
        ]);
        verifyAuthenticationIsolationProbe(authenticationProbe);
        return {
          gatewayContainer,
          gatewayImageId,
          fixtureImageId,
          solverImageId,
          agentNetwork(agentId) {
            return agentNetworks[agentId];
          },
          credentialEnvFile(agentId) {
            return agentCredentialFiles[agentId];
          },
          endpoint(agentId) {
            return `http://git-gateway:8080/${agentId}/repository.git`;
          },
          async inspectAgentIsolation(agentContainers) {
            const { stdout: gatewayIdOutput } = await execFileAsync("docker", [
              "inspect",
              "--format",
              "{{.Id}}",
              gatewayContainer,
            ]);
            const gatewayContainerId = gatewayIdOutput.trim();
            const { stdout: networkOutput } = await execFileAsync("docker", [
              "network",
              "inspect",
              ...Object.values(agentNetworks),
            ]);
            const inspectedNetworks = JSON.parse(networkOutput) as Array<{
              Name: string;
              Id: string;
              Internal: boolean;
              Containers: Record<string, unknown> | null;
            }>;
            const containerIds = [
              gatewayContainerId,
              ...AGENT_IDS.map((id) => agentContainers[id]),
            ];
            const containerNetworks = await Promise.all(
              containerIds.map(async (containerId) => {
                const { stdout } = await execFileAsync("docker", [
                  "inspect",
                  "--format",
                  "{{json .NetworkSettings.Networks}}",
                  containerId,
                ]);
                const connections = JSON.parse(stdout) as Record<string, { NetworkID?: unknown }>;
                return {
                  containerId,
                  networkIds: Object.values(connections).map((connection) =>
                    String(connection.NetworkID),
                  ),
                };
              }),
            );
            return validateAgentNetworkTopology({
              gatewayContainerId,
              agentContainers,
              agentNetworkNames: agentNetworks,
              networks: inspectedNetworks.map((network) => ({
                name: network.Name,
                id: network.Id,
                internal: network.Internal,
                memberContainerIds: Object.keys(network.Containers ?? {}),
              })),
              containerNetworks,
            });
          },
          async closeAdmission() {
            await execFileAsync("docker", ["kill", "--signal=USR1", gatewayContainer]);
            for (let attempt = 0; attempt < 35; attempt += 1) {
              const error = await readFile(
                `${options.repository}/gateway-drain-error`,
                "utf8",
              ).catch(() => null);
              if (error !== null) {
                throw new Error(`Git Gateway drain failed: ${error}`);
              }
              const marker = await readFile(
                `${options.repository}/gateway-drained.json`,
                "utf8",
              ).catch(() => null);
              if (marker !== null) return;
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
            throw new Error("Git Gateway did not acknowledge the closed admission drain.");
          },
          async publishSnapshot(request) {
            if (!Number.isSafeInteger(request.eventSequence) || request.eventSequence < 0) {
              throw new Error(
                "Git publication event sequence must be a non-negative safe integer.",
              );
            }
            const paths = gatewayPublicationPaths(options.repository, request.slot);
            await writeFile(
              paths.request,
              canonicalJsonBytes({
                schemaVersion: 1,
                runId: options.identity.runId,
                slot: request.slot,
                ordinal: publicationOrdinal(request.slot),
                eventSequence: request.eventSequence,
              }),
              { flag: "wx" },
            );
            await execFileAsync("docker", ["kill", "--signal=USR2", gatewayContainer]);
            for (let attempt = 0; attempt < 200; attempt += 1) {
              const error = await readFile(paths.error, "utf8").catch(() => null);
              if (error !== null) {
                throw new Error(`Git Gateway publication failed: ${error}`);
              }
              const marker = await readFile(paths.marker, "utf8").catch(() => null);
              if (marker === "published\n") {
                return readFile(paths.evidence);
              }
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
            throw new Error(`Git Gateway did not acknowledge ${request.slot} publication.`);
          },
          async close() {
            try {
              const listedContainers = await Promise.all(
                Object.values(agentNetworks).map(async (network) => {
                  const { stdout } = await execFileAsync("docker", [
                    "ps",
                    "--all",
                    "--filter",
                    `network=${network}`,
                    "--format",
                    "{{.ID}}",
                  ]);
                  return stdout.split("\n").filter(Boolean);
                }),
              );
              const containers = [...new Set(listedContainers.flat())];
              if (containers.length > 0) {
                await execFileAsync("docker", ["rm", "--force", ...containers]);
              }
              await execFileAsync("docker", ["network", "rm", ...Object.values(agentNetworks)]);
            } finally {
              await rm(secretRoot, { recursive: true, force: true });
            }
          },
        };
      }
      const { stdout: running } = await execFileAsync("docker", [
        "inspect",
        "--format",
        "{{.State.Running}}",
        gatewayContainer,
      ]);
      if (running.trim() !== "true") {
        throw new Error(`Containerized Git Gateway exited before readiness:\n${logs}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Containerized Git Gateway did not become ready.");
  } catch (error) {
    await execFileAsync("docker", ["rm", "--force", gatewayContainer]).catch(() => {});
    await execFileAsync("docker", ["network", "rm", ...Object.values(agentNetworks)]).catch(
      () => {},
    );
    await rm(secretRoot, { recursive: true, force: true });
    throw error;
  }
}
