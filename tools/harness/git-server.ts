import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";

import { AGENT_IDS } from "./config.js";

interface GitServer {
  endpoint(agentId: (typeof AGENT_IDS)[number]): string;
  close(): Promise<void>;
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

export async function startGitServer(options: {
  repository: string;
  secrets: Record<(typeof AGENT_IDS)[number], string>;
  host?: string;
  port?: number;
}): Promise<GitServer> {
  const repository = resolve(options.repository);
  const repositoryName = `/${repository.split("/").at(-1)!}`;
  const backend = resolve(
    (await import("node:child_process"))
      .execFileSync("git", ["--exec-path"], {
        encoding: "utf8",
      })
      .trim(),
    "git-http-backend",
  );
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
    const child = spawn(backend, [], {
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: dirname(repository),
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: pathInfo,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: request.headers["content-length"] ?? "",
        REMOTE_USER: agentId,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    request.pipe(child.stdin);
    const chunks: Buffer[] = [];
    let headersSent = false;
    child.stdout.on("data", (chunk: Buffer) => {
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
      if (!headersSent) response.writeHead(code === 0 ? 200 : 500);
      response.end();
    });
    child.once("error", () => {
      if (!headersSent) response.writeHead(500);
      response.end();
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
    close() {
      return new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
