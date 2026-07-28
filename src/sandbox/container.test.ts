import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SandboxInfrastructureError,
  type AgentSandboxLeaseRequest,
  type SandboxIdentity,
} from "./contracts.js";
import { dockerHostEnvironment, DockerCommandSandbox } from "./container.js";

const TEST_IDENTITY: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"1".repeat(64)}`,
  sourceDigest: "2".repeat(64),
  profileVersion: 1,
};
const temporaryRoots: string[] = [];

interface DockerFixture {
  executable: string;
  log: string;
  request: AgentSandboxLeaseRequest;
}

async function dockerFixture(mode: string): Promise<DockerFixture> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-container-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const sharedGit = join(root, "shared.git");
  const reference = join(root, "reference");
  const log = join(root, "docker.log");
  const interrupted = join(root, "interrupted");
  const executable = join(root, "docker");
  await Promise.all([mkdir(workspace), mkdir(evidence), mkdir(sharedGit), mkdir(reference)]);
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$1" >> ${JSON.stringify(log)}`,
      `mode=${JSON.stringify(mode)}`,
      'if [ "$1" = "create" ] && [ "$mode" = "stalled-create" ]; then sleep 5; fi',
      `if [ "$1" = "exec" ] && [ "$mode" = "interrupt-once" ] && [ ! -e ${JSON.stringify(interrupted)} ]; then`,
      `  touch ${JSON.stringify(interrupted)}`,
      '  printf "Cannot connect to the Docker daemon" >&2',
      "  exit 125",
      "fi",
      'if [ "$1" = "exec" ]; then',
      '  printf "command output"',
      '  printf "command diagnostic" >&2',
      "  exit 7",
      "fi",
      'if [ "$1" = "inspect" ]; then',
      '  if [ "$mode" = "invalid-inspect" ]; then',
      '    printf "not json"',
      "  else",
      '    printf \'[{"State":{"Status":"running","ExitCode":0,"OOMKilled":false,"Error":""}}]\'',
      "  fi",
      "fi",
      'if [ "$1" = "rm" ] && [ "$mode" = "cleanup-failure" ]; then',
      '  printf "cleanup unavailable" >&2',
      "  exit 1",
      "fi",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  return {
    executable,
    log,
    request: {
      profile: "agent",
      timeoutMs: 1_000,
      workspacePath: workspace,
      evidencePath: evidence,
      referenceCorpusPath: reference,
      sharedGitPath: sharedGit,
    },
  };
}

async function waitForCreate(log: string): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    try {
      if ((await readFile(log, "utf8")).split("\n").includes("create")) return;
    } catch {
      // The fake Docker process has not created its log yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Fake Docker create did not start.");
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("sandbox container lifecycle", () => {
  it("passes trusted Docker client configuration without unrelated host secrets", () => {
    const names = [
      "DOCKER_API_VERSION",
      "DOCKER_AUTH_CONFIG",
      "DOCKER_BUILDKIT",
      "DOCKER_CERT_PATH",
      "DOCKER_CLI_EXPERIMENTAL",
      "DOCKER_CONFIG",
      "DOCKER_CONTENT_TRUST",
      "DOCKER_CONTENT_TRUST_SERVER",
      "DOCKER_CONTEXT",
      "DOCKER_CUSTOM_HEADERS",
      "DOCKER_DEFAULT_PLATFORM",
      "DOCKER_HIDE_LEGACY_COMMANDS",
      "DOCKER_HOST",
      "DOCKER_TLS",
      "DOCKER_TLS_VERIFY",
      "BUILDKIT_PROGRESS",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
      "all_proxy",
      "NO_COLOR",
      "SSH_AUTH_SOCK",
    ] as const;
    for (const [index, name] of names.entries()) {
      vi.stubEnv(name, `trusted-${String(index)}`);
    }
    vi.stubEnv("OPENAI_API_KEY", "provider-secret");
    vi.stubEnv("PALIMPSEST_SENTINEL", "unrelated");

    const environment = dockerHostEnvironment();

    for (const [index, name] of names.entries()) {
      expect(environment[name]).toBe(`trusted-${String(index)}`);
    }
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("PALIMPSEST_SENTINEL");
  });

  it("executes multiple commands through one lease and removes it only when closed", async () => {
    const fixture = await dockerFixture("success");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);
    const lease = await sandbox.openAgentLease(fixture.request);

    await expect(lease.execute({ command: "true", timeoutMs: 1_000 })).resolves.toEqual({
      exitCode: 7,
      stdout: "command output",
      stderr: "command diagnostic",
      timedOut: false,
      outputExceeded: false,
      sandboxGeneration: 1,
    });
    await expect(lease.execute({ command: "false", timeoutMs: 1_000 })).resolves.toMatchObject({
      exitCode: 7,
      sandboxGeneration: 1,
    });
    expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toEqual([
      "create",
      "start",
      "inspect",
      "exec",
      "inspect",
      "exec",
      "inspect",
    ]);

    await lease.close();
    expect((await readFile(fixture.log, "utf8")).trim().split("\n").at(-1)).toBe("rm");
  });

  it("classifies invalid lease inspection as infrastructure failure and cleans up", async () => {
    const fixture = await dockerFixture("invalid-inspect");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);

    await expect(sandbox.openAgentLease(fixture.request)).rejects.toBeInstanceOf(
      SandboxInfrastructureError,
    );
    expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toEqual([
      "create",
      "start",
      "inspect",
      "rm",
    ]);
  });

  it("replaces an interrupted lease without replaying the command", async () => {
    const fixture = await dockerFixture("interrupt-once");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);
    const lease = await sandbox.openAgentLease(fixture.request);

    await expect(
      lease.execute({ command: "touch durable", timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      exitCode: null,
      indeterminate: true,
      sandboxGeneration: 2,
      stderr: expect.stringContaining("was not replayed"),
    });
    expect(
      (await readFile(fixture.log, "utf8"))
        .trim()
        .split("\n")
        .filter((entry) => entry === "exec"),
    ).toHaveLength(1);

    await expect(
      lease.execute({ command: "test -e durable", timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      exitCode: 7,
      sandboxGeneration: 2,
    });
    await lease.close();
  });

  it("surfaces lease cleanup failure instead of claiming completion", async () => {
    const fixture = await dockerFixture("cleanup-failure");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);
    const lease = await sandbox.openAgentLease(fixture.request);

    await expect(lease.close()).rejects.toThrow(/Docker cleanup failed: cleanup unavailable/);
    await expect(lease.close()).rejects.toThrow(/Docker cleanup failed: cleanup unavailable/);
    expect(
      (await readFile(fixture.log, "utf8"))
        .trim()
        .split("\n")
        .filter((operation) => operation === "rm"),
    ).toHaveLength(2);
  });

  it("bounds agent lease creation and cleans up a late container", async () => {
    const fixture = await dockerFixture("stalled-create");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);

    await expect(
      sandbox.openAgentLease({ ...fixture.request, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(SandboxInfrastructureError);
    const operations = (await readFile(fixture.log, "utf8")).trim().split("\n");
    expect(operations).toContain("rm");
    expect(operations.every((operation) => operation === "create" || operation === "rm")).toBe(
      true,
    );
  }, 10_000);

  it("cancels agent lease creation and still cleans up", async () => {
    const fixture = await dockerFixture("stalled-create");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable);
    const controller = new AbortController();
    const opening = sandbox.openAgentLease({
      ...fixture.request,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    await waitForCreate(fixture.log);
    controller.abort();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    const operations = (await readFile(fixture.log, "utf8")).trim().split("\n");
    expect(operations[0]).toBe("create");
    expect(operations.slice(1).length).toBeGreaterThan(0);
    expect(new Set(operations.slice(1))).toEqual(new Set(["rm"]));
  }, 10_000);
});
