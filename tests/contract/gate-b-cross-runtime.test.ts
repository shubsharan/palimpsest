import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import { type ContractId, validateValue } from "@palimpsest/contracts";

const execFileAsync = promisify(execFile);

interface Case {
  contractId: ContractId;
  value: unknown;
}

function verdict(case_: Case) {
  const result = validateValue(case_.contractId, case_.value);
  return {
    accepted: result.accepted,
    pointer: result.pointer,
    reason: result.reason,
    sha256: result.accepted ? result.sha256 : null,
  };
}

describe("Gate B cross-runtime contracts", () => {
  test("TypeScript and Python agree on build records, frozen judged fixtures, and a mutation", async () => {
    const paths: Array<[ContractId, string]> = [
      [
        "gate-b-source-record",
        "artifacts/gate-b/instances/instance-amber/sealed/source-record.json",
      ],
      [
        "gate-b-prepared-plaintext-manifest",
        "artifacts/gate-b/instances/instance-amber/sealed/prepared-manifest.json",
      ],
      [
        "gate-b-entity-regeneration-map",
        "artifacts/gate-b/instances/instance-amber/sealed/entity-map.json",
      ],
      [
        "gate-b-public-instance-manifest",
        "artifacts/gate-b/instances/instance-amber/public/manifest.json",
      ],
      [
        "gate-b-oracle-manifest",
        "artifacts/gate-b/instances/instance-amber/sealed/oracle-manifest.json",
      ],
    ];
    const cases: Case[] = await Promise.all(
      paths.map(async ([contractId, path]) => ({
        contractId,
        value: JSON.parse(await readFile(path, "utf8")),
      })),
    );
    const judgedFixtures = JSON.parse(
      await readFile("tests/contract/fixtures/gate-b-post-admission.valid.json", "utf8"),
    ) as Array<{ contractId: ContractId }>;
    cases.push(
      ...judgedFixtures.map((value) => ({
        contractId: value.contractId,
        value,
      })),
    );
    const mutated = structuredClone(cases[3]!);
    (mutated.value as Record<string, unknown>).sourceIdentityLeak = true;
    cases.push(mutated);
    const casePath = ".artifacts-tmp/gate-b-contract-cases.json";
    await mkdir(".artifacts-tmp", { recursive: true });
    await writeFile(casePath, JSON.stringify(cases));
    const { stdout } = await execFileAsync(
      "uv",
      [
        "run",
        "--offline",
        "--frozen",
        "--project",
        "python",
        "python",
        "-m",
        "palimpsest.contracts.validation",
        "--values-file",
        casePath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(cases.map(verdict)).toEqual(JSON.parse(stdout));
    expect(cases.slice(0, -1).every((case_) => verdict(case_).accepted)).toBe(true);
    expect(verdict(cases.at(-1)!).accepted).toBe(false);
  });
});
