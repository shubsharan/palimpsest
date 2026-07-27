import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  captureFetchSnapshot,
  materializeSnapshotRepository,
  publishSnapshot,
} from "@palimpsest/git-gateway";

import { startGitServer } from "../../tools/harness/git-server.js";

const execFileAsync = promisify(execFile);
const agents = ["agent-1", "agent-2", "agent-3"] as const;
const temporaryRoots: string[] = [];

async function git(arguments_: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

async function postGitService(options: {
  endpoint: string;
  service: "git-receive-pack" | "git-upload-pack";
  headers?: Record<string, string>;
  body?: Buffer;
  endRequest?: boolean;
}): Promise<{ status: number | undefined; body: string }> {
  const endpoint = new URL(options.endpoint);
  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${endpoint.pathname}/${options.service}`,
        method: "POST",
        agent: false,
        auth: `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`,
        headers: {
          Connection: "close",
          "Content-Type": `application/x-${options.service}-request`,
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => {
          resolveResponse({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
          if (options.endRequest === false) outgoing.destroy();
        });
      },
    );
    outgoing.once("error", rejectResponse);
    if (options.body) outgoing.write(options.body);
    if (options.endRequest !== false) outgoing.end();
  });
}

async function requestGitBytes(options: {
  endpoint: string;
  method: "GET" | "POST";
  path: string;
  contentType?: string;
  body?: Buffer;
}): Promise<{ status: number | undefined; contentType: string | undefined; body: Buffer }> {
  const endpoint = new URL(options.endpoint);
  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${endpoint.pathname}/${options.path}`,
        method: options.method,
        agent: false,
        auth: `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`,
        headers: {
          Connection: "close",
          ...(options.contentType ? { "Content-Type": options.contentType } : {}),
          ...(options.body ? { "Content-Length": String(options.body.byteLength) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolveResponse({
            status: response.statusCode,
            contentType: response.headers["content-type"],
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    outgoing.once("error", rejectResponse);
    outgoing.end(options.body);
  });
}

function packet(payload: string): Buffer {
  const bytes = Buffer.from(payload, "utf8");
  return Buffer.concat([
    Buffer.from((bytes.byteLength + 4).toString(16).padStart(4, "0"), "ascii"),
    bytes,
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("three-worker native Git transport", () => {
  test("bounds receive attempts, raw ingress, and duration while preserving drain", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-receive-bounds-"));
    temporaryRoots.push(root);
    const seed = join(root, "seed");
    const repository = join(root, "repository.git");
    const hooksRoot = join(root, "gateway-hooks");
    await git(["init", "--quiet", "--object-format=sha256", seed]);
    await git(["config", "user.name", "Palimpsest Fixture"], seed);
    await git(["config", "user.email", "fixture@palimpsest.invalid"], seed);
    await writeFile(join(seed, "README.md"), "fixture genesis\n");
    await git(["add", "README.md"], seed);
    await git(["commit", "--quiet", "-m", "genesis"], seed);
    await git(["branch", "-M", "main"], seed);
    await git(["clone", "--quiet", "--bare", seed, repository]);
    await git(["config", "http.receivepack", "true"], repository);

    const server = await startGitServer({
      repository,
      stagingRefMode: true,
      hooksRoot,
      maxReceiveAttemptsPerAgent: 1,
      maxReceiveBodyBytes: 8,
      receiveTimeoutMs: 30,
      secrets: {
        "agent-1": "secret-1",
        "agent-2": "secret-2",
        "agent-3": "secret-3",
      },
    });
    try {
      expect(await git(["config", "--get", "core.hooksPath"], repository)).toBe(
        join(hooksRoot, "repository-001"),
      );
      await expect(
        postGitService({
          endpoint: server.endpoint("agent-1"),
          service: "git-receive-pack",
          headers: { "Content-Length": "9" },
        }),
      ).resolves.toEqual({ status: 413, body: "receive body limit exceeded\n" });
      await expect(
        postGitService({
          endpoint: server.endpoint("agent-1"),
          service: "git-receive-pack",
          headers: { "Content-Length": "0" },
        }),
      ).resolves.toEqual({ status: 429, body: "receive attempt limit exceeded\n" });
      await expect(
        postGitService({
          endpoint: server.endpoint("agent-2"),
          service: "git-receive-pack",
          headers: { "Content-Length": "8" },
          body: Buffer.from("x"),
          endRequest: false,
        }),
      ).resolves.toEqual({ status: 408, body: "receive timeout\n" });
      await expect(
        postGitService({
          endpoint: server.endpoint("agent-3"),
          service: "git-receive-pack",
          headers: { "Transfer-Encoding": "chunked" },
          body: Buffer.alloc(9, 1),
        }),
      ).resolves.toEqual({ status: 413, body: "receive body limit exceeded\n" });
      server.closeAdmission();
      await expect(server.drainAdmission(1_000)).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  }, 30_000);

  test("serves fetches from the immutable snapshot captured at request start", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-snapshot-git-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const repository = join(root, "repository.git");
    await git(["init", "--quiet", "--object-format=sha256", source]);
    await git(["config", "user.name", "Palimpsest Fixture"], source);
    await git(["config", "user.email", "fixture@palimpsest.invalid"], source);
    await writeFile(join(source, "README.md"), "genesis\n");
    await git(["add", "README.md"], source);
    await git(["commit", "--quiet", "-m", "genesis"], source);
    await git(["branch", "-M", "main"], source);
    await writeFile(join(source, "peer.txt"), "published\n");
    await git(["add", "peer.txt"], source);
    await git(["commit", "--quiet", "-m", "published peer state"], source);
    const publishedOid = await git(["rev-parse", "HEAD"], source);
    await git(["branch", "agents/agent-2/work"], source);
    await git(["reset", "--quiet", "--hard", "HEAD~1"], source);
    await git(["clone", "--quiet", "--bare", source, repository]);
    await git(
      ["push", "--quiet", repository, `${publishedOid}:refs/heads/agents/agent-2/work`],
      source,
    );
    const refs = {
      "refs/heads/main": await git(["rev-parse", "refs/heads/main"], repository),
      "refs/heads/agents/agent-2/work": publishedOid,
    };
    const snapshotRepository = join(root, "publication-001", "repository.git");
    const view = await materializeSnapshotRepository({
      sourceRepository: repository,
      destination: snapshotRepository,
      refs,
    });
    const snapshot = publishSnapshot({
      runId: "run-snapshot",
      ordinal: 1,
      refs,
      visibilityJournalDigest: "b".repeat(64),
      eventSequence: 1,
    });
    const captured = captureFetchSnapshot(snapshot, view);
    const fetches: Array<{
      agentId: string;
      snapshotId: string;
      wants: readonly string[];
      haves: readonly string[];
      digest: string;
    }> = [];
    const server = await startGitServer({
      repository,
      secrets: {
        "agent-1": "secret-1",
        "agent-2": "secret-2",
        "agent-3": "secret-3",
      },
      maxFetchesPerAgent: 4,
      captureFetch: () => captureFetchSnapshot(captured.snapshot, captured.view),
      async onFetch({ agentId, tuple }) {
        fetches.push({
          agentId,
          snapshotId: tuple.snapshotId,
          wants: tuple.wants,
          haves: tuple.haves,
          digest: tuple.digest,
        });
      },
    });
    try {
      await writeFile(join(source, "unpublished.txt"), "not in snapshot\n");
      await git(["add", "unpublished.txt"], source);
      await git(["commit", "--quiet", "-m", "unpublished state"], source);
      const unpublishedOid = await git(["rev-parse", "HEAD"], source);
      await git(["push", "--quiet", repository, "HEAD:refs/heads/private/hidden"], source);
      await git(["update-ref", "refs/heads/agents/agent-2/work", unpublishedOid], repository);

      const firstAdvertisement = await requestGitBytes({
        endpoint: server.endpoint("agent-1"),
        method: "GET",
        path: "info/refs?service=git-upload-pack",
      });
      const repeatedAdvertisement = await requestGitBytes({
        endpoint: server.endpoint("agent-1"),
        method: "GET",
        path: "info/refs?service=git-upload-pack",
      });
      expect(firstAdvertisement.status).toBe(200);
      expect(firstAdvertisement.contentType).toBe("application/x-git-upload-pack-advertisement");
      expect(repeatedAdvertisement.body.equals(firstAdvertisement.body)).toBe(true);
      expect(firstAdvertisement.body.toString("utf8")).not.toContain("refs/heads/private/hidden");

      const advertised = await git(["ls-remote", server.endpoint("agent-1")]);
      expect(advertised).toContain(`${publishedOid}\trefs/heads/agents/agent-2/work`);
      expect(advertised).not.toContain("refs/heads/private/hidden");

      const client = join(root, "client");
      await git(["init", "--quiet", "--object-format=sha256", client]);
      await git(["remote", "add", "origin", server.endpoint("agent-1")], client);
      await git(["fetch", "--quiet", "origin", "refs/heads/main:refs/remotes/origin/main"], client);
      await git(
        [
          "fetch",
          "--quiet",
          "origin",
          "refs/heads/agents/agent-2/work:refs/remotes/origin/agent-2-work",
        ],
        client,
      );
      expect(await git(["rev-parse", "refs/remotes/origin/agent-2-work"], client)).toBe(
        publishedOid,
      );
      expect(fetches).toHaveLength(2);
      expect(fetches[0]).toEqual({
        agentId: "agent-1",
        snapshotId: "publication-001",
        wants: [refs["refs/heads/main"]],
        haves: [],
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(fetches[1]).toEqual({
        agentId: "agent-1",
        snapshotId: "publication-001",
        wants: [publishedOid],
        haves: expect.arrayContaining([refs["refs/heads/main"]]),
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const canonicalCapabilities = ["agent=git/2.48.1", "object-format=sha256", "side-band-64k"];
      const firstRequest = Buffer.concat([
        packet(`want ${publishedOid} ${canonicalCapabilities.join(" ")}\n`),
        Buffer.from("0000", "ascii"),
        packet("done\n"),
      ]);
      const permutedRequest = Buffer.concat([
        packet(`want ${publishedOid} side-band-64k agent=git/2.48.1 object-format=sha256\n`),
        packet(`want ${publishedOid}\n`),
        Buffer.from("0000", "ascii"),
        packet("done\n"),
      ]);
      const firstResponse = await requestGitBytes({
        endpoint: server.endpoint("agent-1"),
        method: "POST",
        path: "git-upload-pack",
        contentType: "application/x-git-upload-pack-request",
        body: firstRequest,
      });
      const permutedResponse = await requestGitBytes({
        endpoint: server.endpoint("agent-1"),
        method: "POST",
        path: "git-upload-pack",
        contentType: "application/x-git-upload-pack-request",
        body: permutedRequest,
      });
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.contentType).toBe("application/x-git-upload-pack-result");
      expect(permutedResponse.body.equals(firstResponse.body)).toBe(true);
      expect(fetches).toHaveLength(4);
      expect(fetches[2]!.digest).toBe(fetches[3]!.digest);
      const endpoint = new URL(server.endpoint("agent-1"));
      const overLimit = await new Promise<{ status: number | undefined; body: string }>(
        (resolveResponse, rejectResponse) => {
          const fetch = request(
            {
              hostname: endpoint.hostname,
              port: endpoint.port,
              path: `${endpoint.pathname}/git-upload-pack`,
              method: "POST",
              auth: `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`,
              headers: {
                "Content-Type": "application/x-git-upload-pack-request",
                "Content-Length": "4",
              },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk: Buffer) => chunks.push(chunk));
              response.once("end", () =>
                resolveResponse({
                  status: response.statusCode,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          fetch.once("error", rejectResponse);
          fetch.end("0000");
        },
      );
      expect(overLimit).toEqual({ status: 429, body: "fetch rate limit exceeded\n" });

      await git(["remote", "add", "outsider", server.endpoint("agent-2")], client);
      await expect(git(["fetch", "--quiet", "outsider", unpublishedOid], client)).rejects.toThrow();
      expect(fetches).toHaveLength(4);
    } finally {
      await server.close();
    }
  }, 30_000);

  test("authenticates clones and carries independent commit/push/fetch workflows", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-native-git-"));
    temporaryRoots.push(root);
    const seed = join(root, "seed");
    const repository = join(root, "repository.git");
    await git(["init", "--quiet", "--object-format=sha256", seed]);
    await git(["config", "user.name", "Palimpsest Fixture"], seed);
    await git(["config", "user.email", "fixture@palimpsest.invalid"], seed);
    await writeFile(join(seed, "README.md"), "fixture genesis\n");
    await git(["add", "README.md"], seed);
    await git(["commit", "--quiet", "-m", "genesis"], seed);
    await git(["branch", "-M", "main"], seed);
    await git(["clone", "--quiet", "--bare", seed, repository]);
    await git(["config", "http.receivepack", "true"], repository);

    const server = await startGitServer({
      repository,
      secrets: {
        "agent-1": "secret-1",
        "agent-2": "secret-2",
        "agent-3": "secret-3",
      },
    });
    try {
      await Promise.all(
        agents.map(async (agentId) => {
          const clone = join(root, agentId);
          await git(["clone", "--quiet", server.endpoint(agentId), clone]);
          await git(["config", "user.name", agentId], clone);
          await git(["config", "user.email", `${agentId}@palimpsest.invalid`], clone);
          await writeFile(join(clone, `${agentId}.txt`), `${agentId} hypothesis\n`);
          await git(["add", `${agentId}.txt`], clone);
          await git(["commit", "--quiet", "-m", `${agentId} work`], clone);
          await git(["push", "--quiet", "origin", `HEAD:refs/heads/agents/${agentId}/work`], clone);
        }),
      );
      const refs = await git(
        ["for-each-ref", "--format=%(refname)", "refs/heads/agents"],
        repository,
      );
      expect(refs.split("\n").sort()).toEqual(
        agents.map((agentId) => `refs/heads/agents/${agentId}/work`),
      );

      const agentOne = join(root, "agent-1");
      await git(
        [
          "fetch",
          "--quiet",
          "origin",
          "refs/heads/agents/agent-2/work:refs/remotes/origin/agent-2-work",
        ],
        agentOne,
      );
      expect(await git(["rev-parse", "refs/remotes/origin/agent-2-work"], agentOne)).toMatch(
        /^[0-9a-f]{64}$/,
      );

      const unauthorized = new URL(server.endpoint("agent-1"));
      unauthorized.password = "wrong";
      await expect(git(["ls-remote", unauthorized.toString()])).rejects.toThrow();

      const staging = await startGitServer({
        repository,
        stagingRefMode: true,
        hooksRoot: join(root, "staging-hooks"),
        secrets: {
          "agent-1": "staging-1",
          "agent-2": "staging-2",
          "agent-3": "staging-3",
        },
        async onReceive() {
          const rejectedRef = "refs/heads/quarantine/agent-1/rejected";
          const exists = await git(
            ["show-ref", "--verify", "--hash", rejectedRef],
            repository,
          ).then(
            () => true,
            () => false,
          );
          if (exists) {
            await git(["update-ref", "-d", rejectedRef], repository);
            throw new Error("test admission rejection");
          }
        },
      });
      try {
        expect(await git(["config", "--get", "core.hooksPath"], repository)).toBe(
          join(root, "staging-hooks", "repository-001"),
        );
        await git([
          "-C",
          agentOne,
          "push",
          "--quiet",
          staging.endpoint("agent-1"),
          "HEAD:refs/heads/quarantine/agent-1/work",
        ]);
        await expect(
          git([
            "-C",
            agentOne,
            "push",
            "--quiet",
            staging.endpoint("agent-1"),
            "HEAD:refs/heads/quarantine/agent-2/work",
          ]),
        ).rejects.toThrow();
        await expect(
          git([
            "-C",
            agentOne,
            "push",
            "--quiet",
            staging.endpoint("agent-1"),
            "HEAD:refs/heads/quarantine/agent-1/rejected",
          ]),
        ).rejects.toThrow();
        await expect(
          git(["show-ref", "--verify", "refs/heads/quarantine/agent-1/rejected"], repository),
        ).rejects.toThrow();
        expect(
          await git([
            "ls-remote",
            staging.endpoint("agent-2"),
            "refs/heads/quarantine/agent-1/work",
          ]),
        ).toBe("");
        expect(await git(["rev-parse", "refs/heads/quarantine/agent-1/work"], repository)).toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(
          (await git(["config", "--get-all", "receive.hideRefs"], repository)).split("\n").sort(),
        ).toEqual(["refs/heads/agents", "refs/heads/quarantine"]);
        const endpoint = new URL(staging.endpoint("agent-1"));
        const incompleteReceive = new Promise<number | undefined>((resolveStatus, rejectStatus) => {
          const receive = request(
            {
              hostname: endpoint.hostname,
              port: endpoint.port,
              path: `${endpoint.pathname}/git-receive-pack`,
              method: "POST",
              auth: `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`,
              headers: {
                "Content-Type": "application/x-git-receive-pack-request",
                "Content-Length": "128",
              },
            },
            (response) => resolveStatus(response.statusCode),
          );
          receive.once("error", rejectStatus);
          receive.write(Buffer.from("partial"));
        });
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        await expect(
          git([
            "-C",
            agentOne,
            "push",
            "--quiet",
            staging.endpoint("agent-1"),
            "HEAD:refs/heads/quarantine/agent-1/concurrent",
          ]),
        ).rejects.toThrow();
        staging.closeAdmission();
        await expect(incompleteReceive).resolves.toBe(503);
        await staging.drainAdmission(1_000);
        await expect(
          git([
            "-C",
            agentOne,
            "push",
            "--quiet",
            staging.endpoint("agent-1"),
            "HEAD:refs/heads/quarantine/agent-1/late",
          ]),
        ).rejects.toThrow();
        expect(await git(["ls-remote", staging.endpoint("agent-1"), "refs/heads/main"])).toMatch(
          /^[0-9a-f]{64}\s+refs\/heads\/main$/,
        );
      } finally {
        await staging.close();
      }
    } finally {
      await server.close();
    }
  }, 30_000);
});
