import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

import { integerFlag, requiredFlag } from "../flags.js";
import type { DecodeStreamEvent, ViewerRun, ViewerToolDetail } from "./contracts.js";
import { loadViewerRun } from "./load.js";
import { reconstructDecodeReplay } from "./replay.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function commonHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    ...commonHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

class ReplayBroadcaster {
  readonly #events: () => AsyncIterable<DecodeStreamEvent>;
  readonly #history: DecodeStreamEvent[] = [];
  readonly #listeners = new Set<(event: DecodeStreamEvent) => void>();
  #started = false;
  #finished = false;

  constructor(events: () => AsyncIterable<DecodeStreamEvent>) {
    this.#events = events;
  }

  subscribe(listener: (event: DecodeStreamEvent) => void): () => void {
    for (const event of this.#history) listener(event);
    if (!this.#finished) this.#listeners.add(listener);
    if (!this.#started) {
      this.#started = true;
      void this.#run();
    }
    return () => this.#listeners.delete(listener);
  }

  async #run(): Promise<void> {
    try {
      for await (const event of this.#events()) {
        this.#publish(event);
      }
    } catch (error) {
      this.#publish({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#finished = true;
      this.#listeners.clear();
    }
  }

  #publish(event: DecodeStreamEvent): void {
    this.#history.push(event);
    for (const listener of this.#listeners) listener(event);
  }
}

async function buildViewerAssets(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-viewer-assets-"));
  const uiRoot = fileURLToPath(new URL("./ui", import.meta.url));
  try {
    await build({
      root: uiRoot,
      plugins: [react()],
      logLevel: "silent",
      build: {
        outDir: temporaryRoot,
        emptyOutDir: true,
      },
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: temporaryRoot,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
  };
}

async function serveAsset(
  assetRoot: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const candidate = resolve(assetRoot, requested);
  const relation = relative(assetRoot, candidate);
  if (relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    json(response, 404, { error: "Not found." });
    return;
  }
  let path = candidate;
  try {
    if (!(await stat(path)).isFile()) throw new Error("Not a file.");
  } catch {
    path = join(assetRoot, "index.html");
  }
  response.writeHead(200, {
    ...commonHeaders(),
    "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(response);
}

export async function startViewerServer(options: {
  root: string;
  runRoot: string;
  port?: number;
  assetRoot?: string;
  viewerRun?: ViewerRun;
  viewerToolDetails?: ReadonlyMap<number, ViewerToolDetail>;
  replayEvents?: () => AsyncIterable<DecodeStreamEvent>;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const root = resolve(options.root);
  const runRoot = resolve(options.runRoot);
  const port = options.port ?? 4_173;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Viewer port must be an integer from 0 through 65535.");
  }
  const generatedAssets = options.assetRoot === undefined ? await buildViewerAssets() : undefined;
  const assetRoot = resolve(options.assetRoot ?? generatedAssets!.path);
  let run: ViewerRun;
  let toolDetails: ReadonlyMap<number, ViewerToolDetail>;
  try {
    if (options.viewerRun === undefined) {
      const loaded = await loadViewerRun(root, runRoot);
      run = loaded.run;
      toolDetails = loaded.toolDetails;
    } else {
      run = options.viewerRun;
      toolDetails = options.viewerToolDetails ?? new Map();
    }
  } catch (error) {
    await generatedAssets?.cleanup();
    throw error;
  }
  const replay = new ReplayBroadcaster(
    options.replayEvents ?? (() => reconstructDecodeReplay({ root, runRoot })),
  );
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method !== "GET") {
          json(response, 405, { error: "Method not allowed." });
          return;
        }
        if (url.pathname === "/api/run") {
          json(response, 200, run);
          return;
        }
        const toolDetailMatch = /^\/api\/tool\/(\d+)$/.exec(url.pathname);
        if (toolDetailMatch !== null) {
          const startedSequence = Number(toolDetailMatch[1]);
          const detail = Number.isSafeInteger(startedSequence)
            ? toolDetails.get(startedSequence)
            : undefined;
          if (detail === undefined) {
            json(response, 404, { error: "Tool detail not found." });
          } else {
            json(response, 200, detail);
          }
          return;
        }
        if (url.pathname === "/api/decode/events") {
          response.writeHead(200, {
            ...commonHeaders(),
            "Content-Type": "text/event-stream; charset=utf-8",
            Connection: "keep-alive",
          });
          response.write(": replay stream\n\n");
          const unsubscribe = replay.subscribe((event) => {
            response.write(`event: replay\ndata: ${JSON.stringify(event)}\n\n`);
            if (event.type === "complete" || event.type === "failed") response.end();
          });
          request.once("close", unsubscribe);
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          json(response, 404, { error: "Not found." });
          return;
        }
        await serveAsset(assetRoot, url.pathname, response);
      } catch (error) {
        if (!response.headersSent) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        } else {
          response.destroy(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await generatedAssets?.cleanup();
    throw new Error("Viewer server did not expose a TCP address.");
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
      );
      await generatedAssets?.cleanup();
    },
  };
}

export async function runViewerFromFlags(
  flags: ReadonlyMap<string, string>,
  root = resolve("."),
): Promise<void> {
  for (const flag of flags.keys()) {
    if (flag !== "--run-root" && flag !== "--port") {
      throw new Error(`Unknown viewer option ${flag}.`);
    }
  }
  const port = integerFlag(flags, "--port", 4_173);
  const viewer = await startViewerServer({
    root,
    runRoot: requiredFlag(flags, "--run-root"),
    port,
  });
  process.stdout.write(`${JSON.stringify({ url: viewer.url })}\n`);
  await new Promise<void>((resolveClosed) => {
    const close = () => {
      void viewer.close().finally(resolveClosed);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}
