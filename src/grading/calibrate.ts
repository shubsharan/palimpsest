import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { contentDigest } from "../canonical.js";
import { decodeRunScorecard, type RunScorecardV2 } from "./contracts.js";

export interface CalibrateOptions {
  readonly artifactsRoot: string;
  readonly output: string;
  readonly now?: () => Date;
}

export interface CalibrationResult {
  readonly calibrationId: string;
  readonly scorecardCount: number;
  readonly path: string;
}

function contained(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
}

async function discoverScorecards(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (!contained(root, directory))
      throw new Error("Calibration discovery escaped its artifacts root.");
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === "scorecard.json") result.push(path);
    }
  }
  await visit(root);
  return result;
}

function ratingPairs(scorecard: RunScorecardV2): readonly { left: number; right: number }[] {
  const ledgers = [scorecard.epistemic, scorecard.social, scorecard.instrumental];
  return ledgers.flatMap((ledger) => {
    const reviewers = ledger.reviewers;
    if (!Array.isArray(reviewers) || reviewers.length !== 2) return [];
    const dimensions = reviewers.map((reviewer) => {
      if (typeof reviewer !== "object" || reviewer === null) return [];
      const value = (reviewer as Record<string, unknown>).dimensions;
      return Array.isArray(value) ? value : [];
    });
    return dimensions[0]!.flatMap((left, index) => {
      const right = dimensions[1]![index];
      if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
        return [];
      const leftRating = (left as Record<string, unknown>).rating;
      const rightRating = (right as Record<string, unknown>).rating;
      return typeof leftRating === "number" && typeof rightRating === "number"
        ? [{ left: leftRating, right: rightRating }]
        : [];
    });
  });
}

export async function calibrateReviews(options: CalibrateOptions): Promise<CalibrationResult> {
  const root = await realpath(resolve(options.artifactsRoot));
  const paths = await discoverScorecards(root);
  const scorecards = (
    await Promise.all(
      paths.map(async (path) => {
        const value = JSON.parse(await readFile(path, "utf8")) as unknown;
        if (!Array.isArray(value))
          throw new Error(`Calibration scorecard ${path} must contain an array.`);
        return value.map((item, index) => decodeRunScorecard(item, `${path}[${String(index)}]`));
      }),
    )
  )
    .flat()
    .filter((scorecard): scorecard is RunScorecardV2 => scorecard.schemaVersion === 2);
  if (scorecards.length === 0)
    throw new Error("Calibration requires at least one scorecard-v2 artifact.");
  const pairs = scorecards.flatMap(ratingPairs);
  const claims = scorecards.flatMap(({ dossier }) =>
    dossier.reviewers.flatMap(({ evidence }) => evidence.claims),
  );
  const episodes = scorecards.flatMap(({ dossier }) =>
    dossier.reviewers.flatMap(({ evidence }) => evidence.epistemicEpisodes),
  );
  const citationCount = claims.reduce(
    (total, claim) => total + claim.evidence.length + claim.counterevidence.length,
    0,
  );
  const report = {
    schemaVersion: 1,
    kind: "automated-structural-calibration",
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    boundary:
      "This provider-free report measures structural integrity and reviewer stability; it does not establish construct validity.",
    scorecardCount: scorecards.length,
    metrics: {
      explicitEvaluationUnitRate: scorecards.every(({ dossier }) =>
        dossier.reviewers.every(({ evidence }) => evidence.evaluationUnit.actorIds.length > 0),
      )
        ? 1
        : 0,
      structuredClaimCount: claims.length,
      citationCount,
      citationDigestValidityRate:
        citationCount === 0
          ? null
          : claims
              .flatMap((claim) => [...claim.evidence, ...claim.counterevidence])
              .filter(({ excerptDigest }) => /^[0-9a-f]{64}$/.test(excerptDigest)).length /
            citationCount,
      stageConsistencyRate:
        episodes.length === 0
          ? null
          : episodes.filter(
              (episode) => episode.integration.length === 0 || episode.uptake.length > 0,
            ).length / episodes.length,
      observability: Object.fromEntries(
        ["observed", "contradicted", "unobservable", "not-applicable"].map((state) => [
          state,
          claims.filter((claim) => claim.state === state).length,
        ]),
      ),
      ratingPairCount: pairs.length,
      exactRatingAgreementRate:
        pairs.length === 0
          ? null
          : pairs.filter(({ left, right }) => left === right).length / pairs.length,
      adjacentRatingAgreementRate:
        pairs.length === 0
          ? null
          : pairs.filter(({ left, right }) => Math.abs(left - right) <= 1).length / pairs.length,
      materialRatingDisagreementRate:
        pairs.length === 0
          ? null
          : pairs.filter(({ left, right }) => Math.abs(left - right) >= 2).length / pairs.length,
    },
  };
  const calibrationId = `calibration-${contentDigest(report).slice(0, 24)}`;
  const output = resolve(options.output);
  try {
    await lstat(output);
    throw new Error(`Calibration output directory already exists: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(output)}-`));
  try {
    const path = join(staging, "calibration.json");
    await writeFile(path, `${JSON.stringify({ calibrationId, ...report }, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    calibrationId,
    scorecardCount: scorecards.length,
    path: join(output, "calibration.json"),
  };
}
