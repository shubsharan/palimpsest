import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  PushAdmissionWindow,
  canonicalFetchTuple,
  canonicalUploadPackAdvertisement,
  canonicalUploadPackResponse,
  parseUploadPackRequest,
  type CanonicalFetchTuple,
  type CapturedFetch,
  type ReceiveToken,
} from "@palimpsest/git-gateway";

import { AGENT_IDS } from "./config.js";

interface GitServer {
  endpoint(agentId: (typeof AGENT_IDS)[number]): string;
  closeAdmission(): void;
  drainAdmission(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface CompletedReceive {
  agentId: (typeof AGENT_IDS)[number];
  arrivalSequence: number;
}

export interface CompletedFetch {
  agentId: (typeof AGENT_IDS)[number];
  tuple: CanonicalFetchTuple;
}

function authenticate(request: IncomingMessage, agentId: string, secret: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded === `${agentId}:${secret}`;
}

function respondUnauthorized(response: ServerResponse): void {
  response.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Palimpsest Git Gateway"',
    "Content-Type": "text/plain",
  });
  response.end("authentication required\n");
}

const execFileAsync = promisify(execFile);

async function configureStagingReceive(repository: string, externalHooks?: string): Promise<void> {
  const hooks = externalHooks ?? join(repository, "hooks");
  const preReceive = join(hooks, "pre-receive");
  await mkdir(hooks, { recursive: true });
  if (externalHooks) {
    await execFileAsync("git", ["-C", repository, "config", "core.hooksPath", hooks]);
  }
  await writeFile(
    preReceive,
    [
      "#!/bin/sh",
      "set -eu",
      'prefix="refs/heads/quarantine/${REMOTE_USER}/"',
      "update_count=0",
      "while read -r old_oid new_oid ref_name",
      "do",
      "  update_count=$((update_count + 1))",
      '  case "$ref_name" in',
      '    "$prefix"*) ;;',
      '    *) printf "unauthorized ref namespace\\n" >&2; exit 1 ;;',
      "  esac",
      '  test "$new_oid" != "0000000000000000000000000000000000000000000000000000000000000000" || exit 1',
      "done",
      'test "$update_count" -eq 1 || { printf "exactly one ref update is required\\n" >&2; exit 1; }',
      "",
    ].join("\n"),
  );
  await chmod(preReceive, 0o755);
  await execFileAsync("git", [
    "-C",
    repository,
    "config",
    "--add",
    "uploadpack.hideRefs",
    "refs/heads/quarantine",
  ]);
  await execFileAsync("git", [
    "-C",
    repository,
    "config",
    "--add",
    "uploadpack.hideRefs",
    "refs/heads/agents",
  ]);
  await execFileAsync("git", [
    "-C",
    repository,
    "config",
    "--add",
    "receive.hideRefs",
    "refs/heads/quarantine",
  ]);
  await execFileAsync("git", [
    "-C",
    repository,
    "config",
    "--add",
    "receive.hideRefs",
    "refs/heads/agents",
  ]);
  await execFileAsync("git", ["-C", repository, "config", "receive.denyDeletes", "true"]);
}

export async function startGitServer(options: {
  repository: string;
  repositories?: Partial<Record<(typeof AGENT_IDS)[number], string>>;
  secrets: Record<(typeof AGENT_IDS)[number], string>;
  host?: string;
  port?: number;
  stagingRefMode?: boolean;
  hooksRoot?: string;
  maxFetchesPerAgent?: number;
  maxReceiveAttemptsPerAgent?: number;
  maxReceiveBodyBytes?: number;
  receiveTimeoutMs?: number;
  captureFetch?: (agentId: (typeof AGENT_IDS)[number]) => CapturedFetch | undefined;
  onFetch?: (fetch: CompletedFetch) => Promise<void>;
  onReceive?: (receive: CompletedReceive) => Promise<void>;
}): Promise<GitServer> {
  const repository = resolve(options.repository);
  const repositories = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, resolve(options.repositories?.[agentId] ?? repository)]),
  ) as Record<(typeof AGENT_IDS)[number], string>;
  if (options.stagingRefMode) {
    const uniqueRepositories = [...new Set(Object.values(repositories))];
    for (const [index, stagingRepository] of uniqueRepositories.entries()) {
      await configureStagingReceive(
        stagingRepository,
        options.hooksRoot
          ? join(resolve(options.hooksRoot), `repository-${String(index + 1).padStart(3, "0")}`)
          : undefined,
      );
    }
  }
  const admissionWindow = new PushAdmissionWindow();
  const repositoryName = `/${repository.split("/").at(-1)!}`;
  const backend = resolve(
    (await import("node:child_process"))
      .execFileSync("git", ["--exec-path"], {
        encoding: "utf8",
      })
      .trim(),
    "git-http-backend",
  );
  const activeReceives = new Set<{
    agentId: (typeof AGENT_IDS)[number];
    bodyComplete: boolean;
    abort(): void;
  }>();
  const activeReceiveAgents = new Set<(typeof AGENT_IDS)[number]>();
  if (
    options.maxFetchesPerAgent !== undefined &&
    (!Number.isSafeInteger(options.maxFetchesPerAgent) || options.maxFetchesPerAgent < 1)
  ) {
    throw new Error("Git fetch limit must be a positive safe integer.");
  }
  for (const [name, value] of [
    ["Git receive attempt limit", options.maxReceiveAttemptsPerAgent],
    ["Git receive body limit", options.maxReceiveBodyBytes],
    ["Git receive timeout", options.receiveTimeoutMs],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`${name} must be a positive safe integer.`);
    }
  }
  const fetchRequestCounts = new Map<(typeof AGENT_IDS)[number], number>();
  const receiveAttemptCounts = new Map<(typeof AGENT_IDS)[number], number>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://palimpsest.invalid");
    const match = /^\/(agent-[123])(\/repository\.git\/.*)$/.exec(url.pathname);
    const agentId = match?.[1] as (typeof AGENT_IDS)[number] | undefined;
    const pathInfo = match?.[2];
    if (!agentId || !pathInfo || !authenticate(request, agentId, options.secrets[agentId])) {
      respondUnauthorized(response);
      return;
    }
    if (!pathInfo.startsWith(`${repositoryName}/`)) {
      response.writeHead(404).end();
      return;
    }
    const receiveDiscovery =
      request.method === "GET" &&
      pathInfo.endsWith("/info/refs") &&
      url.searchParams.get("service") === "git-receive-pack";
    const receiveRequest = request.method === "POST" && pathInfo.endsWith("/git-receive-pack");
    const uploadDiscovery =
      request.method === "GET" &&
      pathInfo.endsWith("/info/refs") &&
      url.searchParams.get("service") === "git-upload-pack";
    const uploadRequest = request.method === "POST" && pathInfo.endsWith("/git-upload-pack");
    const capturedFetch =
      uploadDiscovery || uploadRequest ? options.captureFetch?.(agentId) : undefined;
    if (uploadRequest && capturedFetch && options.maxFetchesPerAgent !== undefined) {
      const fetchCount = fetchRequestCounts.get(agentId) ?? 0;
      if (fetchCount >= options.maxFetchesPerAgent) {
        response.writeHead(429, { "Content-Type": "text/plain" });
        response.end("fetch rate limit exceeded\n");
        return;
      }
      fetchRequestCounts.set(agentId, fetchCount + 1);
    }
    if (capturedFetch && !capturedFetch.view?.repository) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("captured fetch has no materialized repository\n");
      return;
    }
    if (
      uploadRequest &&
      capturedFetch &&
      request.headers["content-encoding"] !== undefined &&
      request.headers["content-encoding"] !== "identity"
    ) {
      response.writeHead(415, { "Content-Type": "text/plain" });
      response.end("encoded upload-pack requests are not supported\n");
      return;
    }
    if (uploadDiscovery && capturedFetch) {
      try {
        const body = canonicalUploadPackAdvertisement(capturedFetch);
        response.sendDate = false;
        response.writeHead(200, {
          "Cache-Control": "no-cache, max-age=0, must-revalidate",
          "Content-Length": String(body.byteLength),
          "Content-Type": "application/x-git-upload-pack-advertisement",
          Expires: "Fri, 01 Jan 1980 00:00:00 GMT",
          Pragma: "no-cache",
        });
        response.end(body);
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("canonical fetch advertisement failed\n");
      }
      return;
    }
    if (uploadRequest && capturedFetch) {
      const declaredLength = Number(request.headers["content-length"]);
      if (Number.isSafeInteger(declaredLength) && declaredLength > 16 * 1024 * 1024) {
        response.writeHead(413, { "Content-Type": "text/plain" });
        response.end("upload-pack request is too large\n");
        request.resume();
        return;
      }
      const requestChunks: Buffer[] = [];
      let requestBytes = 0;
      let requestRejected = false;
      request.on("data", (chunk: Buffer) => {
        requestBytes += chunk.byteLength;
        if (requestBytes > 16 * 1024 * 1024) {
          requestRejected = true;
          requestChunks.length = 0;
          return;
        }
        requestChunks.push(chunk);
      });
      request.once("end", () => {
        void (async () => {
          if (requestRejected) {
            response.writeHead(413, { "Content-Type": "text/plain" });
            response.end("upload-pack request is too large\n");
            return;
          }
          let tuple: CanonicalFetchTuple;
          try {
            const parsed = parseUploadPackRequest(Buffer.concat(requestChunks));
            tuple = canonicalFetchTuple({
              captured: capturedFetch,
              wants: parsed.wants,
              haves: parsed.haves,
              capabilities: parsed.capabilities,
            });
          } catch {
            response.writeHead(409, { "Content-Type": "text/plain" });
            response.end("fetch rejected\n");
            return;
          }
          try {
            const body = await canonicalUploadPackResponse({ captured: capturedFetch, tuple });
            await options.onFetch?.({ agentId, tuple });
            response.sendDate = false;
            response.writeHead(200, {
              "Cache-Control": "no-cache, max-age=0, must-revalidate",
              "Content-Length": String(body.byteLength),
              "Content-Type": "application/x-git-upload-pack-result",
              Expires: "Fri, 01 Jan 1980 00:00:00 GMT",
              Pragma: "no-cache",
            });
            response.end(body);
          } catch {
            response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("canonical fetch response failed\n");
          }
        })();
      });
      request.once("aborted", () => {
        if (!response.headersSent) response.destroy();
      });
      return;
    }
    if ((receiveDiscovery || receiveRequest) && !admissionWindow.isOpen) {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end("push admission closed\n");
      return;
    }
    let receiveToken: ReceiveToken | undefined;
    if (receiveRequest) {
      const attemptCount = receiveAttemptCounts.get(agentId) ?? 0;
      if (
        options.maxReceiveAttemptsPerAgent !== undefined &&
        attemptCount >= options.maxReceiveAttemptsPerAgent
      ) {
        response.writeHead(429, { "Content-Type": "text/plain" });
        response.end("receive attempt limit exceeded\n");
        return;
      }
      receiveAttemptCounts.set(agentId, attemptCount + 1);
      const declaredLength = Number(request.headers["content-length"]);
      if (
        options.maxReceiveBodyBytes !== undefined &&
        Number.isSafeInteger(declaredLength) &&
        declaredLength > options.maxReceiveBodyBytes
      ) {
        response.writeHead(413, { "Content-Type": "text/plain" });
        response.end("receive body limit exceeded\n");
        return;
      }
      if (activeReceiveAgents.has(agentId)) {
        response.writeHead(409, { "Content-Type": "text/plain" });
        response.end("one receive per authenticated agent may be active\n");
        return;
      }
      try {
        receiveToken = admissionWindow.beginReceive();
        activeReceiveAgents.add(agentId);
      } catch {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("push admission closed\n");
        return;
      }
    }
    let receiveCompleted = false;
    const completeReceive = () => {
      if (!receiveToken || receiveCompleted) return;
      receiveCompleted = true;
      activeReceiveAgents.delete(agentId);
      receiveToken.complete();
    };
    const child = spawn(backend, [], {
      // Uncaptured initial Git transport and receives continue through the native CGI backend.
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: dirname(capturedFetch?.view?.repository ?? repositories[agentId]),
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: pathInfo,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: request.headers["content-length"] ?? "",
        REMOTE_USER: agentId,
        ...(options.stagingRefMode
          ? {
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "receive.hideRefs",
              GIT_CONFIG_VALUE_0: `!refs/heads/quarantine/${agentId}`,
            }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {
      // Limit-triggered termination may close stdin before the request finishes.
    });
    let receiveRejection: "admission-closed" | "body-limit" | "timeout" | undefined;
    let receiveBodyBytes = 0;
    let receiveTimer: NodeJS.Timeout | undefined;
    const abortReceive = (reason: typeof receiveRejection) => {
      if (!receiveRequest || receiveRejection) return;
      receiveRejection = reason;
      request.unpipe(child.stdin);
      child.stdin.destroy();
      request.resume();
      child.kill("SIGTERM");
    };
    const activeReceive = receiveRequest
      ? {
          agentId,
          bodyComplete: false,
          abort() {
            abortReceive("admission-closed");
          },
        }
      : undefined;
    if (activeReceive) {
      activeReceives.add(activeReceive);
      if (options.maxReceiveBodyBytes !== undefined) {
        request.on("data", (chunk: Buffer) => {
          receiveBodyBytes += chunk.byteLength;
          if (receiveBodyBytes > options.maxReceiveBodyBytes!) {
            abortReceive("body-limit");
          }
        });
      }
      if (options.receiveTimeoutMs !== undefined) {
        receiveTimer = setTimeout(() => abortReceive("timeout"), options.receiveTimeoutMs);
        receiveTimer.unref();
      }
      request.once("end", () => {
        activeReceive.bodyComplete = true;
      });
    }
    request.pipe(child.stdin);
    const chunks: Buffer[] = [];
    let headersSent = false;
    let childFailed = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (receiveRequest) {
        chunks.push(chunk);
        return;
      }
      if (headersSent) {
        response.write(chunk);
        return;
      }
      chunks.push(chunk);
      const combined = Buffer.concat(chunks);
      const boundary = combined.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const rawHeaders = combined.subarray(0, boundary).toString("utf8").split("\r\n");
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of rawHeaders) {
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const name = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();
        if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      headersSent = true;
      response.write(combined.subarray(boundary + 4));
    });
    child.stderr.on("data", () => {
      // Backend diagnostics are intentionally not reflected to clients.
    });
    child.once("close", (code) => {
      if (receiveTimer) clearTimeout(receiveTimer);
      if (activeReceive) activeReceives.delete(activeReceive);
      if (childFailed) return;
      if (receiveRequest) {
        void (async () => {
          try {
            if (receiveRejection === "admission-closed") {
              completeReceive();
              response.writeHead(503, { "Content-Type": "text/plain" });
              response.end("push admission closed\n");
              return;
            }
            if (receiveRejection === "body-limit") {
              completeReceive();
              response.writeHead(413, { "Content-Type": "text/plain" });
              response.end("receive body limit exceeded\n");
              return;
            }
            if (receiveRejection === "timeout") {
              completeReceive();
              response.writeHead(408, { "Content-Type": "text/plain" });
              response.end("receive timeout\n");
              return;
            }
            if (code !== 0) {
              completeReceive();
              response.writeHead(500, { "Content-Type": "text/plain" });
              response.end("receive failed\n");
              return;
            }
            await options.onReceive?.({
              agentId,
              arrivalSequence: receiveToken!.arrivalSequence,
            });
          } catch {
            completeReceive();
            response.writeHead(409, { "Content-Type": "text/plain" });
            response.end("push rejected\n");
            return;
          }
          const combined = Buffer.concat(chunks);
          const boundary = combined.indexOf("\r\n\r\n");
          if (boundary < 0) {
            completeReceive();
            response.writeHead(500, { "Content-Type": "text/plain" });
            response.end("invalid receive response\n");
            return;
          }
          const rawHeaders = combined.subarray(0, boundary).toString("utf8").split("\r\n");
          let status = 200;
          const headers: Record<string, string> = {};
          for (const line of rawHeaders) {
            const separator = line.indexOf(":");
            if (separator < 0) continue;
            const name = line.slice(0, separator);
            const value = line.slice(separator + 1).trim();
            if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
            else headers[name] = value;
          }
          response.writeHead(status, headers);
          response.end(combined.subarray(boundary + 4));
          completeReceive();
        })();
        return;
      }
      completeReceive();
      if (!headersSent) response.writeHead(code === 0 ? 200 : 500);
      response.end();
    });
    child.once("error", () => {
      if (receiveTimer) clearTimeout(receiveTimer);
      childFailed = true;
      if (activeReceive) activeReceives.delete(activeReceive);
      completeReceive();
      if (receiveRejection === "admission-closed") {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("push admission closed\n");
      } else if (receiveRejection === "body-limit") {
        response.writeHead(413, { "Content-Type": "text/plain" });
        response.end("receive body limit exceeded\n");
      } else if (receiveRejection === "timeout") {
        response.writeHead(408, { "Content-Type": "text/plain" });
        response.end("receive timeout\n");
      } else {
        if (!headersSent) response.writeHead(500);
        response.end();
      }
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Git Gateway did not bind a TCP address.");
  }
  return {
    endpoint(agentId) {
      const secret = options.secrets[agentId];
      const host = options.host && options.host !== "0.0.0.0" ? options.host : "127.0.0.1";
      return `http://${agentId}:${secret}@${host}:${address.port}/${agentId}/repository.git`;
    },
    closeAdmission() {
      admissionWindow.close();
      for (const receive of activeReceives) {
        if (!receive.bodyComplete) receive.abort();
      }
    },
    drainAdmission(timeoutMs) {
      return admissionWindow.drain(timeoutMs);
    },
    close() {
      return new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
