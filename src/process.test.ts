import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runProcess } from "./process.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-process-"));
  temporaryRoots.push(root);
  return root;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("trusted host process", () => {
  it("uses only the environment explicitly supplied by its domain wrapper", async () => {
    const root = await temporaryRoot();
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "sentinel: process.env.PALIMPSEST_SENTINEL ?? null,",
          "home: process.env.HOME ?? null,",
          "path: process.env.PATH ?? null,",
          "credential: process.env.OPENAI_API_KEY ?? null,",
          "}));",
        ].join(""),
      ],
      {
        cwd: root,
        env: { PALIMPSEST_SENTINEL: "present" },
      },
    );

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      outputExceeded: false,
    });
    expect(JSON.parse(result.stdout.toString("utf8"))).toEqual({
      sentinel: "present",
      home: null,
      path: null,
      credential: null,
    });
    expect(result.stderr).toHaveLength(0);
  });

  it("applies an absolute deadline to the entire process group", async () => {
    const root = await temporaryRoot();
    const readyPath = join(root, "ready");
    const escapedChildPath = join(root, "escaped-child");
    const childSource = [
      "const { writeFileSync } = require('node:fs');",
      `setTimeout(() => writeFileSync(${JSON.stringify(escapedChildPath)}, "escaped"), 1000);`,
      "setInterval(() => undefined, 1000);",
    ].join("");
    const parentSource = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], { stdio: "ignore" });`,
      `writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
      "setInterval(() => undefined, 1000);",
    ].join("");

    const result = await runProcess(process.execPath, ["-e", parentSource], {
      cwd: root,
      env: {},
      deadline: performance.now() + 500,
    });

    expect(result).toMatchObject({
      timedOut: true,
      cancelled: false,
      outputExceeded: false,
    });
    await expect(access(readyPath)).resolves.toBeUndefined();
    await delay(700);
    await expect(access(escapedChildPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts the active process group and reports cancellation separately from timeout", async () => {
    const root = await temporaryRoot();
    const controller = new AbortController();
    const execution = runProcess(process.execPath, ["-e", "setInterval(() => undefined, 1000);"], {
      cwd: root,
      env: {},
      deadline: performance.now() + 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    await expect(execution).resolves.toMatchObject({
      timedOut: false,
      cancelled: true,
      outputExceeded: false,
    });
  });

  it("removes its abort listener after a child exits", async () => {
    const root = await temporaryRoot();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await runProcess(process.execPath, ["-e", ""], {
      cwd: root,
      env: {},
      signal: controller.signal,
    });

    const registration = addListener.mock.calls.find(([event]) => event === "abort");
    expect(registration).toBeDefined();
    expect(removeListener).toHaveBeenCalledWith("abort", registration?.[1]);
  });

  it("caps combined stdout and stderr bytes and terminates the process group", async () => {
    const root = await temporaryRoot();
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        [
          'process.stdout.write("abcdefghijkl");',
          'process.stderr.write("mnopqrstuvwx");',
          "setInterval(() => undefined, 1000);",
        ].join(""),
      ],
      {
        cwd: root,
        env: {},
        maxOutputBytes: 16,
      },
    );

    expect(result).toMatchObject({
      timedOut: false,
      cancelled: false,
      outputExceeded: true,
    });
    expect(result.stdout.byteLength + result.stderr.byteLength).toBe(16);
  });

  it("returns nonzero exits for the domain wrapper to classify", async () => {
    const root = await temporaryRoot();
    const result = await runProcess(
      process.execPath,
      ["-e", 'process.stderr.write("domain failure"); process.exit(7);'],
      {
        cwd: root,
        env: {},
      },
    );

    expect(result).toMatchObject({
      exitCode: 7,
      signal: null,
      timedOut: false,
      cancelled: false,
      outputExceeded: false,
    });
    expect(result.stderr.toString("utf8")).toBe("domain failure");
  });
});
