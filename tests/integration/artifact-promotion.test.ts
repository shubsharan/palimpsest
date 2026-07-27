import { mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  ArtifactRunError,
  createReferenceRequest,
  runReferenceProducer,
  type FailureMode,
} from "../../tools/artifact-runner/index.js";

const temporaryRoots: string[] = [];

async function temporaryStore(): Promise<string> {
  const root = join(
    tmpdir(),
    `palimpsest-artifact-test-${process.pid}-${Date.now()}-${temporaryRoots.length}`,
  );
  await mkdir(root, { recursive: false });
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("artifact promotion boundary", () => {
  test("repeated honest requests promote the same complete artifact", async () => {
    const storeRoot = await temporaryStore();
    const request = await createReferenceRequest({ message: "hello\n" });

    const first = await runReferenceProducer({ request, storeRoot, mode: "honest" });
    const second = await runReferenceProducer({ request, storeRoot, mode: "honest" });

    expect(first.artifactDigest).toBe(second.artifactDigest);
    expect(await readFile(join(first.artifactPath, "outputs/result.txt"), "utf8")).toBe("hello\n");
    expect(await readdir(first.artifactPath)).toEqual(["artifact.tar", "manifest.json", "outputs"]);
  });

  const failures: FailureMode[] = [
    "timeout",
    "producer-failure",
    "malformed-progress",
    "truncated-progress",
    "missing-output",
    "undeclared-output",
    "digest-mismatch",
    "length-mismatch",
    "disallowed-producer-version",
  ];

  test.each(failures)("%s promotes nothing and records a failed attempt", async (mode) => {
    const storeRoot = await temporaryStore();
    const request = await createReferenceRequest({
      deadlineMs: mode === "timeout" ? 50 : 5_000,
      message: "failure fixture\n",
    });

    await expect(runReferenceProducer({ request, storeRoot, mode })).rejects.toBeInstanceOf(
      ArtifactRunError,
    );
    expect(await readdir(join(storeRoot, "promoted")).catch(() => [])).toEqual([]);
    const attempts = await readdir(join(storeRoot, "attempts"));
    expect(attempts).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(storeRoot, "attempts", attempts[0] ?? "", "attempt.json"), "utf8"),
    );
    expect(record.status).toBe("failed");
    expect(record.failure).not.toBeNull();
  });

  test("retry starts from an empty attempt directory with the same request", async () => {
    const storeRoot = await temporaryStore();
    const request = await createReferenceRequest({ message: "retry\n" });

    await expect(
      runReferenceProducer({ request, storeRoot, mode: "undeclared-output" }),
    ).rejects.toBeInstanceOf(ArtifactRunError);
    const promoted = await runReferenceProducer({ request, storeRoot, mode: "honest" });

    expect(await readFile(join(promoted.artifactPath, "outputs/result.txt"), "utf8")).toBe(
      "retry\n",
    );
    expect(await readdir(join(storeRoot, "attempts"))).toHaveLength(2);
  });

  test("the evidence adapter denies producer network access at the OS boundary", async () => {
    const storeRoot = await temporaryStore();
    const request = await createReferenceRequest({ message: "network denied\n" });
    const result = await runReferenceProducer({ request, storeRoot, mode: "network-probe" });
    expect(result.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
