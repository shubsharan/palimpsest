import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SANDBOX_POLICY,
  SandboxInfrastructureError,
  type AgentSandboxLeaseRequest,
  type SandboxIdentity,
  type SolverSandboxCommand,
} from "./contracts.js";
import { dockerHostEnvironment, DockerCommandSandbox } from "./container.js";

const TEST_IDENTITY: SandboxIdentity = {
  imageTag: "palimpsest-puzzle-sandbox:0.1.0",
  imageId: `sha256:${"1".repeat(64)}`,
  sourceDigest: "2".repeat(64),
  profileVersion: 1,
};
const TEST_TIMING = {
  cleanupTimeoutMs: 300,
  pollIntervalMs: 10,
  recoveryProbeTimeoutMs: 25,
} as const;
const temporaryRoots: string[] = [];

interface DockerFixture {
  executable: string;
  log: string;
  request: AgentSandboxLeaseRequest;
}

interface SolverDockerFixture {
  executable: string;
  log: string;
  request: SolverSandboxCommand;
}

async function dockerFixture(mode: string): Promise<DockerFixture> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-container-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const evidence = join(root, "evidence");
  const gitOrigin = join(root, "origin.git");
  const reference = join(root, "reference");
  const log = join(root, "docker.log");
  const interrupted = join(root, "interrupted");
  const inspected = join(root, "inspected");
  const executable = join(root, "docker");
  await Promise.all([mkdir(workspace), mkdir(evidence), mkdir(gitOrigin), mkdir(reference)]);
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
      '  if [ "$mode" = "stalled-inspect" ]; then sleep 5; fi',
      `  if [ "$mode" = "stalled-command-inspect" ] && [ -e ${JSON.stringify(inspected)} ]; then sleep 5; fi`,
      `  touch ${JSON.stringify(inspected)}`,
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
      gitOriginPath: gitOrigin,
    },
  };
}

async function solverDockerFixture(
  mode: "success" | "directory" | "oversized",
): Promise<SolverDockerFixture> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-solver-container-"));
  temporaryRoots.push(root);
  const submission = join(root, "submission");
  const outputRoot = join(root, "output");
  const ciphertextPath = join(root, "ciphertext.txt");
  const log = join(root, "docker.log");
  const solverExecuted = join(root, "solver-executed");
  const executable = join(root, "docker");
  await Promise.all([
    mkdir(submission),
    mkdir(outputRoot),
    writeFile(ciphertextPath, "ciphertext\n"),
  ]);
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$1" >> ${JSON.stringify(log)}`,
      `mode=${JSON.stringify(mode)}`,
      `if [ "$1" = "exec" ] && [ ! -e ${JSON.stringify(solverExecuted)} ]; then`,
      `  touch ${JSON.stringify(solverExecuted)}`,
      "  exit 0",
      "fi",
      'if [ "$1" = "exec" ]; then',
      '  if [ "$mode" = "directory" ]; then exit 41; fi',
      '  if [ "$mode" = "oversized" ]; then',
      `    dd if=/dev/zero bs=${String(SANDBOX_POLICY.solverOutputBytes + 1)} count=1 2>/dev/null`,
      "    exit 0",
      "  fi",
      '  printf "reconstruction\\n"',
      "  exit 0",
      "fi",
      'if [ "$1" = "inspect" ]; then',
      '  printf \'[{"State":{"Status":"running","ExitCode":0,"OOMKilled":false,"Error":""}}]\'',
      "fi",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  return {
    executable,
    log,
    request: {
      profile: "solver",
      command: "python3 solver.py",
      timeoutMs: 1_000,
      submissionPath: submission,
      ciphertextPath,
      outputRoot,
      outputPath: "reconstruction.txt",
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
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);
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

  it("extracts and atomically publishes only the declared solver output", async () => {
    const fixture = await solverDockerFixture("success");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

    await expect(sandbox.execute(fixture.request)).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputExceeded: false,
    });
    await expect(
      readFile(join(fixture.request.outputRoot, fixture.request.outputPath), "utf8"),
    ).resolves.toBe("reconstruction\n");
    expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toEqual([
      "create",
      "start",
      "exec",
      "inspect",
      "exec",
      "rm",
    ]);
  });

  it("rejects non-file solver output without publishing a durable path", async () => {
    const fixture = await solverDockerFixture("directory");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

    await expect(sandbox.execute(fixture.request)).resolves.toMatchObject({
      exitCode: 0,
      outputFailure: "Solver output must be a regular file.",
    });
    await expect(
      readFile(join(fixture.request.outputRoot, fixture.request.outputPath), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects solver output one byte beyond the extraction limit", async () => {
    const fixture = await solverDockerFixture("oversized");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

    await expect(sandbox.execute(fixture.request)).resolves.toMatchObject({
      exitCode: 0,
      outputFailure: `Solver output exceeds ${String(SANDBOX_POLICY.solverOutputBytes)} bytes.`,
    });
    await expect(
      readFile(join(fixture.request.outputRoot, fixture.request.outputPath), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("classifies invalid lease inspection as infrastructure failure and cleans up", async () => {
    const fixture = await dockerFixture("invalid-inspect");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

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

  it("bounds lease inspection by the setup deadline and cleans up", async () => {
    const fixture = await dockerFixture("stalled-inspect");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

    await expect(sandbox.openAgentLease({ ...fixture.request, timeoutMs: 500 })).rejects.toThrow(
      "Docker container inspection timed out.",
    );
    expect((await readFile(fixture.log, "utf8")).trim().split("\n")).toEqual([
      "create",
      "start",
      "inspect",
      "rm",
    ]);
  });

  it("bounds post-command inspection by the command deadline", async () => {
    const fixture = await dockerFixture("stalled-command-inspect");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);
    const lease = await sandbox.openAgentLease(fixture.request);

    await expect(lease.execute({ command: "exit 7", timeoutMs: 100 })).rejects.toThrow(
      "Docker did not recover before the command deadline.",
    );
    await lease.close();
  });

  it("replaces an interrupted lease without replaying the command", async () => {
    const fixture = await dockerFixture("interrupt-once");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);
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
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);
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
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);

    await expect(
      sandbox.openAgentLease({ ...fixture.request, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(SandboxInfrastructureError);
    const operations = (await readFile(fixture.log, "utf8")).trim().split("\n");
    expect(operations).toContain("rm");
    expect(operations.every((operation) => operation === "create" || operation === "rm")).toBe(
      true,
    );
  });

  it("cancels agent lease creation and still cleans up", async () => {
    const fixture = await dockerFixture("stalled-create");
    const sandbox = new DockerCommandSandbox(TEST_IDENTITY, fixture.executable, TEST_TIMING);
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
  });
});
