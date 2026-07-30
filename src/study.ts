import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  decodeAttemptSummary,
  decodeBuildManifest,
  decodeDesignReceipt,
  decodePhaseSummary,
  designReceiptPath,
  phaseSummaryPath,
  publishDesignReceipt,
  publishPhaseSummary,
  readDesignReceipt,
  readPhaseSummary,
  selectBuildVariant,
  type AttemptSummary,
  type BuildManifest,
  type DesignBuildBinding,
  type DesignReceipt,
  type PhaseAdjustment,
  type PhaseSummary,
  type PlannedCell,
  type StudyPhase,
} from "./artifacts.js";
import { buildPuzzle, type BuildPuzzleOptions } from "./build.js";
import {
  CONDITION_IDS,
  hashProtocolSnapshot,
  resolveCondition,
  type CommunicationMode,
  type ConditionId,
} from "./condition.js";
import { expandPhase, type ResolvedStudy } from "./config.js";
import type { AgentId } from "./model.js";
import { readSourceState, type SourceState } from "./preflight.js";
import { buildAgentPrompt, snapshotAgentPromptTemplates, type PromptAgentId } from "./prompt.js";
import { readJsonObject } from "./python.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import { SANDBOX_POLICY, type SandboxIdentity } from "./sandbox/contracts.js";

const AGENT_COUNT = 3;
const CALIBRATION_CELL_COUNT = 4;
const VALIDATION_CELL_COUNT = 16;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return hashProtocolSnapshot(left) === hashProtocolSnapshot(right);
}

function checkedProduct(left: number, right: number, name: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return product;
}

function authorizedTokens(tokenBudgetPerAgent: number): number {
  return checkedProduct(tokenBudgetPerAgent, AGENT_COUNT, "Attempt token authorization");
}

function totalSessionTokens(attempt: AttemptSummary): number {
  return attempt.sessions.reduce(
    (total, session) => total + session.inputTokens + session.outputTokens,
    0,
  );
}

function buildManifestPath(buildRoot: string): string {
  return join(buildRoot, "puzzle-build.json");
}

async function readBuildBinding(buildRoot: string, blockId: string): Promise<DesignBuildBinding> {
  const path = buildManifestPath(buildRoot);
  const bytes = await readFile(path);
  const manifest = decodeBuildManifest(JSON.parse(bytes.toString("utf8")) as unknown);
  if (manifest.blockId !== blockId) {
    throw new Error(`Receipt build ${blockId} contains block ${manifest.blockId}.`);
  }
  await assertBuildArtifacts(buildRoot, blockId, manifest);
  return {
    blockId,
    buildRoot,
    buildManifestDigest: sha256(bytes),
    manifest,
  };
}

function buildArtifactPath(buildRoot: string, artifactPath: string): string {
  const root = resolve(buildRoot);
  const path = resolve(root, artifactPath);
  const difference = relative(root, path);
  if (
    difference.length === 0 ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new Error(`Build artifact path ${artifactPath} must remain inside its build root.`);
  }
  return path;
}

function buildArtifactDigests(
  manifest: BuildManifest,
): readonly { path: string; sha256: string }[] {
  return [
    { path: manifest.allocation.path, sha256: manifest.allocation.sha256 },
    { path: manifest.oracleDesign.path, sha256: manifest.oracleDesign.sha256 },
    { path: manifest.manipulationCheck.path, sha256: manifest.manipulationCheck.sha256 },
    ...[manifest.variants.stationary, manifest.variants.rekey].flatMap((variant) =>
      variant.stages.map((stage) => ({ path: stage.sourcePath, sha256: stage.sha256 })),
    ),
  ];
}

async function assertBuildArtifacts(buildRoot: string, blockId: string, manifest: BuildManifest) {
  await Promise.all(
    buildArtifactDigests(manifest).map(async ({ path, sha256: expected }) => {
      const bytes = await readFile(buildArtifactPath(buildRoot, path));
      const actual = sha256(bytes);
      if (actual !== expected) {
        throw new Error(`Receipt-bound build ${blockId} artifact ${path} has drifted.`);
      }
    }),
  );
  await Promise.all(
    [manifest.variants.stationary, manifest.variants.rekey].map(async (variant) => {
      const ciphertext = await readFile(buildArtifactPath(buildRoot, variant.publicCiphertextPath));
      const expectedReferenceNames = manifest.references
        .map(({ sourceId }) => `${sourceId}-reference.txt`)
        .sort();
      const referenceRoot = buildArtifactPath(buildRoot, variant.referenceCorpusPath);
      const referenceEntries = await readdir(referenceRoot, { withFileTypes: true });
      const actualReferenceNames = referenceEntries.map(({ name }) => name).sort();
      if (
        referenceEntries.some((entry) => !entry.isFile()) ||
        !sameValue(actualReferenceNames, expectedReferenceNames)
      ) {
        throw new Error(
          `Receipt-bound build ${blockId} ${variant.variantId} reference artifact set has drifted.`,
        );
      }
      const references = await Promise.all(
        manifest.references.map(async (reference) => {
          const path = `${variant.referenceCorpusPath}/${reference.sourceId}-reference.txt`;
          const bytes = await readFile(buildArtifactPath(buildRoot, path));
          return {
            sourceId: reference.sourceId,
            sourceSha256: reference.sha256,
            path,
            byteLength: bytes.byteLength,
            sha256: sha256(bytes),
          };
        }),
      );
      const buildId = `build-${hashProtocolSnapshot({
        schemaVersion: 1,
        blockId: manifest.blockId,
        variantId: variant.variantId,
        allocationId: manifest.allocation.allocationId,
        windowSha256: manifest.window.sha256,
        complete: {
          byteLength: ciphertext.byteLength,
          sha256: sha256(ciphertext),
        },
        references,
        stages: variant.stages,
        keyTransitions: variant.keyTransitions,
      })}`;
      if (buildId !== variant.buildId) {
        throw new Error(
          `Receipt-bound build ${blockId} ${variant.variantId} consumed artifact set has drifted.`,
        );
      }
    }),
  );
}

export interface StudyDesignDependencies {
  build: (options: BuildPuzzleOptions) => Promise<unknown>;
  sourceState: (root: string) => Promise<SourceState>;
  sandboxIdentity: (root: string) => Promise<SandboxIdentity>;
  now: () => Date;
}

const defaultDesignDependencies: StudyDesignDependencies = {
  build: buildPuzzle,
  sourceState: readSourceState,
  sandboxIdentity: async (root) => (await createDockerCommandSandbox({ root })).identity,
  now: () => new Date(),
};

function designDependencies(
  overrides: Partial<StudyDesignDependencies> | undefined,
): StudyDesignDependencies {
  return { ...defaultDesignDependencies, ...overrides };
}

function requireCleanStudySource(state: SourceState): void {
  if (!state.sourceClean) {
    throw new Error("Study design preparation requires a clean committed source checkout.");
  }
}

function requireStableStudySource(initial: SourceState, current: SourceState): void {
  requireCleanStudySource(current);
  if (current.testedCommit !== initial.testedCommit) {
    throw new Error("Source revision changed while preparing the study design.");
  }
}

async function assertEmptyUnreceiptedStudyRoot(studyRoot: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(studyRoot);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  if (entries.length !== 0) {
    throw new Error("Study root contains unreceipted artifacts; use a new study root.");
  }
}

async function prepareBuilds(options: {
  root: string;
  studyRoot: string;
  study: ResolvedStudy;
  dependencies: StudyDesignDependencies;
}): Promise<readonly DesignBuildBinding[]> {
  const buildsRoot = join(options.studyRoot, "builds");
  await mkdir(buildsRoot, { recursive: true });
  const bindings: DesignBuildBinding[] = [];
  for (const block of options.study.blocks) {
    const buildRoot = join(buildsRoot, block.blockId);
    await options.dependencies.build({
      root: options.root,
      output: buildRoot,
      block: block.blockId,
    });
    bindings.push(await readBuildBinding(buildRoot, block.blockId));
  }
  return bindings;
}

function promptBindings(
  study: ResolvedStudy,
  tokenBudgetPerAgent = study.budgets.tokenBudgetPerAgent,
): {
  promptTemplates: readonly {
    agentId: AgentId;
    communicationMode: CommunicationMode;
    template: string;
    sha256: string;
  }[];
  baselinePrompts: readonly {
    condition: ConditionId;
    agentId: AgentId;
    prompt: string;
    sha256: string;
  }[];
} {
  const snapshots = snapshotAgentPromptTemplates();
  const promptTemplates = study.assignment.flatMap(({ agentId }) => {
    const promptAgentId = agentId as PromptAgentId;
    return (
      [
        ["shared", snapshots[promptAgentId].CS],
        ["isolated", snapshots[promptAgentId].IS],
      ] as const
    ).map(([communicationMode, template]) => ({
      agentId,
      communicationMode,
      template,
      sha256: sha256(template),
    }));
  });
  const baselinePrompts = study.assignment.flatMap(({ agentId }) =>
    CONDITION_IDS.map((condition) => {
      const prompt = buildAgentPrompt({
        agentId,
        condition,
        tokenBudgetPerAgent,
      });
      return { condition, agentId, prompt, sha256: sha256(prompt) };
    }),
  );
  return { promptTemplates, baselinePrompts };
}

function designIdentity<T extends { manifestDigest: string }>(
  receipt: T,
): Omit<T, "manifestDigest"> {
  const { manifestDigest, ...identity } = receipt;
  if (manifestDigest.length === 0) {
    throw new Error("Design manifest digest cannot be empty.");
  }
  return identity;
}

function assertReceiptDigest(receipt: DesignReceipt): void {
  const { createdAt, designDigest, ...identity } = receipt;
  if (createdAt.length === 0 || hashProtocolSnapshot(designIdentity(identity)) !== designDigest) {
    throw new Error("Study design receipt digest does not match its frozen contents.");
  }
}

function assertReceiptManifestDigest(receipt: DesignReceipt): void {
  const immutableBudgets = receipt.immutableManifest.budgets;
  if (
    typeof immutableBudgets !== "object" ||
    immutableBudgets === null ||
    Array.isArray(immutableBudgets)
  ) {
    throw new Error("Study design receipt immutable manifest budgets are invalid.");
  }
  const baselineManifest = {
    ...receipt.immutableManifest,
    budgets: {
      ...immutableBudgets,
      ...receipt.baselineBudgets,
    },
  };
  if (hashProtocolSnapshot(baselineManifest) !== receipt.manifestDigest) {
    throw new Error("Study design receipt manifestDigest does not match its baseline manifest.");
  }
}

function createDesignReceiptValue(options: {
  study: ResolvedStudy;
  builds: readonly DesignBuildBinding[];
  sourceRevision: string;
  sandbox: SandboxIdentity;
  createdAt: string;
  manifestDigest?: string;
  baselineBudgets?: {
    tokenBudgetPerAgent: number;
    perAttemptMonetaryCeilingCents: number;
  };
}): DesignReceipt {
  const baselineBudgets = options.baselineBudgets ?? options.study.budgets;
  const prompts = promptBindings(options.study, baselineBudgets.tokenBudgetPerAgent);
  const identity = {
    schemaVersion: 1,
    sourceRevision: options.sourceRevision,
    sandbox: { ...options.sandbox, ...SANDBOX_POLICY },
    manifestDigest: options.manifestDigest ?? options.study.manifestDigest,
    immutableManifestDigest: options.study.immutableManifestDigest,
    immutableManifest: options.study.immutableManifest,
    builds: options.builds,
    assignment: options.study.assignment,
    orders: options.study.orders,
    rubric: {
      id: options.study.rubric.rubricId,
      path: options.study.rubric.path,
      sha256: options.study.rubric.sha256,
    },
    scoring: options.study.scoring,
    promptTemplates: prompts.promptTemplates,
    baselinePrompts: prompts.baselinePrompts,
    failurePolicy: {
      stopOn: "session-infrastructure-error",
      automaticRetry: false,
      replacement: "explicit-appended",
    },
    baselineBudgets: {
      tokenBudgetPerAgent: baselineBudgets.tokenBudgetPerAgent,
      perAttemptMonetaryCeilingCents: baselineBudgets.perAttemptMonetaryCeilingCents,
    },
    totalCeilings: {
      tokens: options.study.budgets.totalTokenCeiling,
      monetaryAuthorizationCents: options.study.budgets.totalMonetaryCeilingCents,
    },
  } as const;
  return decodeDesignReceipt({
    ...identity,
    createdAt: options.createdAt,
    designDigest: hashProtocolSnapshot(designIdentity(identity)),
  });
}

function assertPrimaryAuthorization(
  receipt: DesignReceipt,
  validationBudgets: {
    tokenBudgetPerAgent: number;
    perAttemptMonetaryCeilingCents: number;
  },
  replacementAuthorization: { tokens: number; cents: number } = {
    tokens: 0,
    cents: 0,
  },
): void {
  const calibrationTokens = checkedProduct(
    CALIBRATION_CELL_COUNT,
    authorizedTokens(receipt.baselineBudgets.tokenBudgetPerAgent),
    "Calibration primary token authorization",
  );
  const validationTokens = checkedProduct(
    VALIDATION_CELL_COUNT,
    authorizedTokens(validationBudgets.tokenBudgetPerAgent),
    "Validation primary token authorization",
  );
  const calibrationMoney = checkedProduct(
    CALIBRATION_CELL_COUNT,
    receipt.baselineBudgets.perAttemptMonetaryCeilingCents,
    "Calibration primary monetary authorization",
  );
  const validationMoney = checkedProduct(
    VALIDATION_CELL_COUNT,
    validationBudgets.perAttemptMonetaryCeilingCents,
    "Validation primary monetary authorization",
  );
  if (
    calibrationTokens + validationTokens + replacementAuthorization.tokens >
    receipt.totalCeilings.tokens
  ) {
    throw new Error("Study token ceiling cannot authorize the primary matrix and replacements.");
  }
  if (
    calibrationMoney + validationMoney + replacementAuthorization.cents >
    receipt.totalCeilings.monetaryAuthorizationCents
  ) {
    throw new Error("Study monetary ceiling cannot authorize the primary matrix and replacements.");
  }
}

async function assertBuildBindings(
  receipt: DesignReceipt,
  studyRoot: string,
): Promise<readonly DesignBuildBinding[]> {
  const bindings: DesignBuildBinding[] = [];
  for (const expected of receipt.builds) {
    const expectedRoot = join(studyRoot, "builds", expected.blockId);
    if (resolve(expected.buildRoot) !== expectedRoot) {
      throw new Error(`Receipt build ${expected.blockId} has an unexpected root.`);
    }
    const actual = await readBuildBinding(expectedRoot, expected.blockId);
    if (
      actual.buildManifestDigest !== expected.buildManifestDigest ||
      !sameValue(actual.manifest, expected.manifest)
    ) {
      throw new Error(`Receipt-bound build ${expected.blockId} has drifted.`);
    }
    bindings.push(actual);
  }
  return bindings;
}

function assertDesignIdentity(
  actual: DesignReceipt,
  expected: DesignReceipt,
  phase: StudyPhase,
): void {
  if (
    actual.designDigest !== expected.designDigest ||
    actual.immutableManifestDigest !== expected.immutableManifestDigest ||
    !sameValue(actual.immutableManifest, expected.immutableManifest)
  ) {
    throw new Error("Study design receipt does not match the immutable manifest.");
  }
  if (phase === "calibration" && actual.manifestDigest !== expected.manifestDigest) {
    throw new Error("Calibration manifest does not match its design receipt.");
  }
}

export interface PrepareStudyDesignOptions {
  root: string;
  studyRoot: string;
  study: ResolvedStudy;
  phase: StudyPhase;
  dependencies?: Partial<StudyDesignDependencies>;
}

export async function prepareStudyDesign(
  options: PrepareStudyDesignOptions,
): Promise<DesignReceipt> {
  const root = resolve(options.root);
  const studyRoot = resolve(options.studyRoot);
  const deps = designDependencies(options.dependencies);
  const receiptExists = await exists(designReceiptPath(studyRoot));
  if (!receiptExists && options.phase === "validation") {
    throw new Error("Validation requires an existing calibration design receipt.");
  }
  const receipt = receiptExists ? await readDesignReceipt(studyRoot) : undefined;
  if (receipt !== undefined) {
    assertReceiptDigest(receipt);
    assertReceiptManifestDigest(receipt);
  }
  const initialSource = await deps.sourceState(root);
  requireCleanStudySource(initialSource);
  if (receipt === undefined) {
    await assertEmptyUnreceiptedStudyRoot(studyRoot);
  }
  const sandbox = await deps.sandboxIdentity(root);
  const builds = receipt
    ? await assertBuildBindings(receipt, studyRoot)
    : await prepareBuilds({ root, studyRoot, study: options.study, dependencies: deps });
  const expected = createDesignReceiptValue({
    study: options.study,
    builds,
    sourceRevision: initialSource.testedCommit,
    sandbox,
    createdAt: receipt?.createdAt ?? deps.now().toISOString(),
    ...(receipt === undefined
      ? {}
      : {
          manifestDigest:
            options.phase === "calibration" ? options.study.manifestDigest : receipt.manifestDigest,
          baselineBudgets: receipt.baselineBudgets,
        }),
  });
  assertPrimaryAuthorization(expected, expected.baselineBudgets);
  if (receipt !== undefined) {
    assertDesignIdentity(receipt, expected, options.phase);
    return receipt;
  }
  requireStableStudySource(initialSource, await deps.sourceState(root));
  await publishDesignReceipt(studyRoot, expected);
  return readDesignReceipt(studyRoot);
}

function plannedCells(
  study: ResolvedStudy,
  receipt: DesignReceipt,
  phase: StudyPhase,
): readonly PlannedCell[] {
  const builds = new Map(receipt.builds.map((build) => [build.blockId, build]));
  return expandPhase(study, phase).map((cell) => {
    const binding = builds.get(cell.blockId);
    if (binding === undefined) {
      throw new Error(`Design receipt has no build for ${cell.blockId}.`);
    }
    const variant = selectBuildVariant(
      binding.manifest,
      resolveCondition(cell.condition).variantId,
    );
    return {
      ...cell,
      buildRoot: binding.buildRoot,
      pairedBuildId: binding.manifest.pairedBuildId,
      buildId: variant.buildId,
    };
  });
}

function validationAdjustments(
  study: ResolvedStudy,
  receipt: DesignReceipt,
): readonly PhaseAdjustment[] {
  const adjustments: PhaseAdjustment[] = [];
  const values = [
    {
      fieldPath: "budgets.tokenBudgetPerAgent",
      priorValue: receipt.baselineBudgets.tokenBudgetPerAgent,
      resolvedValue: study.budgets.tokenBudgetPerAgent,
    },
    {
      fieldPath: "budgets.perAttemptMonetaryCeilingCents",
      priorValue: receipt.baselineBudgets.perAttemptMonetaryCeilingCents,
      resolvedValue: study.budgets.perAttemptMonetaryCeilingCents,
    },
  ] as const;
  for (const value of values) {
    if (value.priorValue === value.resolvedValue) continue;
    adjustments.push({
      ...value,
      priorManifestDigest: receipt.manifestDigest,
      currentManifestDigest: study.manifestDigest,
    });
  }
  return adjustments;
}

async function readPhaseIfPresent(
  studyRoot: string,
  phase: StudyPhase,
): Promise<PhaseSummary | undefined> {
  return (await exists(phaseSummaryPath(studyRoot, phase)))
    ? readPhaseSummary(studyRoot, phase)
    : undefined;
}

function assertPhaseIdentity(
  summary: PhaseSummary,
  study: ResolvedStudy,
  receipt: DesignReceipt,
  cells: readonly PlannedCell[],
  adjustments: readonly PhaseAdjustment[],
): void {
  if (
    summary.manifestDigest !== study.manifestDigest ||
    summary.immutableManifestDigest !== study.immutableManifestDigest ||
    summary.designDigest !== receipt.designDigest ||
    !sameValue(summary.plannedCells, cells) ||
    !sameValue(summary.adjustments, adjustments)
  ) {
    throw new Error(`${summary.phase} phase summary does not match the current study design.`);
  }
}

function newPhaseSummary(
  study: ResolvedStudy,
  receipt: DesignReceipt,
  phase: StudyPhase,
  cells: readonly PlannedCell[],
  adjustments: readonly PhaseAdjustment[],
): PhaseSummary {
  return decodePhaseSummary({
    schemaVersion: 1,
    phase,
    state: "ready",
    manifestDigest: study.manifestDigest,
    immutableManifestDigest: study.immutableManifestDigest,
    designDigest: receipt.designDigest,
    plannedCells: cells,
    adjustments,
    reservations: [],
    attempts: [],
    cumulativeAuthorizedTokens: 0,
    cumulativeAuthorizedMonetaryCents: 0,
    cumulativeActualTokens: 0,
  });
}

export async function initializeStudyPhase(options: {
  studyRoot: string;
  study: ResolvedStudy;
  receipt: DesignReceipt;
  phase: StudyPhase;
}): Promise<PhaseSummary> {
  const studyRoot = resolve(options.studyRoot);
  await assertBuildBindings(options.receipt, studyRoot);
  if (options.study.immutableManifestDigest !== options.receipt.immutableManifestDigest) {
    throw new Error("Phase manifest contains immutable drift from the design receipt.");
  }
  const adjustments =
    options.phase === "calibration" ? [] : validationAdjustments(options.study, options.receipt);
  if (
    options.phase === "calibration" &&
    options.study.manifestDigest !== options.receipt.manifestDigest
  ) {
    throw new Error("Calibration cannot adjust its receipt-bound manifest.");
  }
  const calibration = await readPhaseIfPresent(studyRoot, "calibration");
  const existing = await readPhaseIfPresent(studyRoot, options.phase);
  const indexedSummaries = options.phase === "validation" ? [calibration, existing] : [existing];
  for (const summary of indexedSummaries) {
    if (summary !== undefined) {
      await assertIndexedAttempts({
        studyRoot,
        summary,
        study: options.study,
        receipt: options.receipt,
      });
    }
  }
  if (options.phase === "validation") {
    if (calibration?.state !== "complete") {
      throw new Error("Validation requires a completed calibration phase.");
    }
  }
  assertPrimaryAuthorization(
    options.receipt,
    options.study.budgets,
    replacementAuthorization([calibration, options.phase === "validation" ? existing : undefined]),
  );
  const cells = plannedCells(options.study, options.receipt, options.phase);
  if (existing !== undefined) {
    assertPhaseIdentity(existing, options.study, options.receipt, cells, adjustments);
    return existing;
  }
  const summary = newPhaseSummary(
    options.study,
    options.receipt,
    options.phase,
    cells,
    adjustments,
  );
  await publishPhaseSummary(studyRoot, summary);
  return summary;
}

function replacementAuthorization(summaries: readonly (PhaseSummary | undefined)[]): {
  tokens: number;
  cents: number;
} {
  return summaries.reduce(
    (total, summary) => {
      for (const reservation of summary?.reservations ?? []) {
        if (reservation.kind !== "replacement") continue;
        total.tokens += reservation.authorizedTokens;
        total.cents += reservation.monetaryAuthorizationCeilingCents;
      }
      return total;
    },
    { tokens: 0, cents: 0 },
  );
}

async function assertReplacementHeadroom(
  studyRoot: string,
  study: ResolvedStudy,
  receipt: DesignReceipt,
): Promise<void> {
  const authorization = replacementAuthorization([
    await readPhaseIfPresent(studyRoot, "calibration"),
    await readPhaseIfPresent(studyRoot, "validation"),
  ]);
  assertPrimaryAuthorization(receipt, study.budgets, {
    tokens: authorization.tokens + authorizedTokens(study.budgets.tokenBudgetPerAgent),
    cents: authorization.cents + study.budgets.perAttemptMonetaryCeilingCents,
  });
}

function successfulCellIds(summary: PhaseSummary): ReadonlySet<string> {
  return new Set(
    summary.attempts
      .filter((attempt) => attempt.infrastructureClassification === "none")
      .map((attempt) => attempt.cellId),
  );
}

function nextPrimaryCell(summary: PhaseSummary): PlannedCell | undefined {
  const successful = successfulCellIds(summary);
  const launched = new Set(
    summary.reservations
      .filter((reservation) => reservation.kind === "primary")
      .map((reservation) => reservation.cellId),
  );
  return summary.plannedCells.find(
    (cell) => !successful.has(cell.cellId) && !launched.has(cell.cellId),
  );
}

function replacementCell(summary: PhaseSummary, attemptId: string): PlannedCell {
  if (
    summary.state !== "blocked" ||
    summary.failure?.kind !== "session-infrastructure-error" ||
    summary.failure.attemptId !== attemptId
  ) {
    throw new Error(
      `Replacement source ${attemptId} is not the phase's current frozen infrastructure failure.`,
    );
  }
  const source = summary.attempts.find((attempt) => attempt.attemptId === attemptId);
  if (
    source?.infrastructureClassification !== "session-infrastructure-error" ||
    summary.attempts.some((attempt) => attempt.replacementOfAttemptId === attemptId)
  ) {
    throw new Error(`Replacement source ${attemptId} is not eligible.`);
  }
  const cell = summary.plannedCells.find((candidate) => candidate.cellId === source.cellId);
  if (cell === undefined) {
    throw new Error(`Replacement source ${attemptId} has no planned cell.`);
  }
  return cell;
}

function reserveLaunch(options: {
  summary: PhaseSummary;
  cell: PlannedCell;
  study: ResolvedStudy;
  kind: "primary" | "replacement";
  replacementOfAttemptId?: string;
  now: Date;
}): { summary: PhaseSummary; reservationId: string; attemptId: string } {
  const ordinal = options.summary.reservations.length + 1;
  const suffix = String(ordinal).padStart(3, "0");
  const reservationId = `reservation-${options.summary.phase}-${suffix}`;
  const attemptId = `attempt-${options.summary.phase}-${String(options.cell.phasePosition).padStart(2, "0")}-${suffix}`;
  const reservation = {
    reservationId,
    cellId: options.cell.cellId,
    reservedAt: options.now.toISOString(),
    kind: options.kind,
    ...(options.replacementOfAttemptId === undefined
      ? {}
      : { replacementOfAttemptId: options.replacementOfAttemptId }),
    authorizedTokens: authorizedTokens(options.study.budgets.tokenBudgetPerAgent),
    monetaryAuthorizationCeilingCents: options.study.budgets.perAttemptMonetaryCeilingCents,
    state: "reserved",
  } as const;
  const reservations = [...options.summary.reservations, reservation];
  return {
    reservationId,
    attemptId,
    summary: decodePhaseSummary({
      ...options.summary,
      state: "running",
      reservations,
      cumulativeAuthorizedTokens: reservations.reduce(
        (sum, item) => sum + item.authorizedTokens,
        0,
      ),
      cumulativeAuthorizedMonetaryCents: reservations.reduce(
        (sum, item) => sum + item.monetaryAuthorizationCeilingCents,
        0,
      ),
      failure: undefined,
    }),
  };
}

function assertAttemptMatchesLaunch(options: {
  attempt: AttemptSummary;
  attemptRoot: string;
  summary: PhaseSummary;
  cell: PlannedCell;
  study: ResolvedStudy;
  receipt: DesignReceipt;
  attemptId: string;
  replacementOfAttemptId?: string;
  budgets?: {
    tokenBudgetPerAgent: number;
    perAttemptMonetaryCeilingCents: number;
  };
}): void {
  const attempt = options.attempt;
  const budgets = options.budgets ?? options.study.budgets;
  if (
    attempt.studyPhase === "standalone" ||
    attempt.attemptId !== options.attemptId ||
    attempt.studyPhase !== options.summary.phase ||
    attempt.studyRootId !== `study-${options.receipt.designDigest.slice(0, 16)}` ||
    attempt.conditionOrderPosition !== options.cell.conditionOrderPosition ||
    attempt.designDigest !== options.receipt.designDigest ||
    attempt.blockId !== options.cell.blockId ||
    attempt.condition !== options.cell.condition ||
    attempt.buildId !== options.cell.buildId ||
    resolve(attempt.buildRoot) !== options.cell.buildRoot ||
    attempt.tokenBudgetPerAgent !== budgets.tokenBudgetPerAgent ||
    attempt.monetaryAuthorizationCeilingCents !== budgets.perAttemptMonetaryCeilingCents ||
    attempt.replacementOfAttemptId !== options.replacementOfAttemptId
  ) {
    throw new Error(`Attempt ${attempt.attemptId} does not match its reserved study cell.`);
  }
  if (
    attempt.sessions.some((session, index) => {
      const assignment = options.study.assignment[index];
      return (
        assignment === undefined ||
        session.agentId !== assignment.agentId ||
        session.model.profile !== assignment.modelProfileId
      );
    })
  ) {
    throw new Error(`Attempt ${attempt.attemptId} does not use the frozen model assignment.`);
  }
  if (resolve(options.attemptRoot) === options.cell.buildRoot) {
    throw new Error("Attempt root cannot overlap its receipt-bound build root.");
  }
}

async function assertIndexedAttempts(options: {
  studyRoot: string;
  summary: PhaseSummary;
  study: ResolvedStudy;
  receipt: DesignReceipt;
}): Promise<void> {
  const cells = new Map(
    plannedCells(options.study, options.receipt, options.summary.phase).map((cell) => [
      cell.cellId,
      cell,
    ]),
  );
  const attemptsRoot = resolve(options.studyRoot, options.summary.phase, "attempts");
  const budgets =
    options.summary.phase === "calibration"
      ? options.receipt.baselineBudgets
      : options.study.budgets;
  for (const reference of options.summary.attempts) {
    const attemptRoot = resolve(reference.attemptRoot);
    if (attemptRoot !== attemptsRoot && !attemptRoot.startsWith(`${attemptsRoot}${sep}`)) {
      throw new Error(`Indexed attempt ${reference.attemptId} is outside its phase attempts root.`);
    }
    const cell = cells.get(reference.cellId);
    if (cell === undefined) {
      throw new Error(`Indexed attempt ${reference.attemptId} references an unknown phase cell.`);
    }
    const reservation = options.summary.reservations.find(
      (candidate) => candidate.reservationId === reference.reservationId,
    );
    if (
      reservation === undefined ||
      reservation.authorizedTokens !== authorizedTokens(budgets.tokenBudgetPerAgent) ||
      reservation.monetaryAuthorizationCeilingCents !== budgets.perAttemptMonetaryCeilingCents
    ) {
      throw new Error(`Indexed attempt ${reference.attemptId} has inconsistent authorization.`);
    }
    const attempt = await readAttempt(attemptRoot);
    if (attempt === undefined) {
      throw new Error(
        `Indexed attempt ${reference.attemptId} is missing its durable attempt.json.`,
      );
    }
    assertAttemptMatchesLaunch({
      attempt,
      attemptRoot,
      summary: options.summary,
      cell,
      study: options.study,
      receipt: options.receipt,
      attemptId: reference.attemptId,
      budgets,
      ...(reference.replacementOfAttemptId === undefined
        ? {}
        : { replacementOfAttemptId: reference.replacementOfAttemptId }),
    });
    if (
      attempt.infrastructureClassification !== reference.infrastructureClassification ||
      totalSessionTokens(attempt) !== reference.actualTokenUsage
    ) {
      throw new Error(`Indexed attempt ${reference.attemptId} does not match its durable summary.`);
    }
  }
}

function indexAttempt(options: {
  summary: PhaseSummary;
  reservationId: string;
  cell: PlannedCell;
  attemptRoot: string;
  attempt: AttemptSummary;
}): PhaseSummary {
  const reservations = options.summary.reservations.map((reservation) =>
    reservation.reservationId === options.reservationId
      ? { ...reservation, state: "resolved" as const, attemptId: options.attempt.attemptId }
      : reservation,
  );
  const attempts = [
    ...options.summary.attempts,
    {
      attemptId: options.attempt.attemptId,
      attemptRoot: resolve(options.attemptRoot),
      cellId: options.cell.cellId,
      reservationId: options.reservationId,
      infrastructureClassification: options.attempt.infrastructureClassification,
      actualTokenUsage: totalSessionTokens(options.attempt),
      ...(options.attempt.replacementOfAttemptId === undefined
        ? {}
        : { replacementOfAttemptId: options.attempt.replacementOfAttemptId }),
    },
  ];
  const successful = new Set(
    attempts
      .filter((attempt) => attempt.infrastructureClassification === "none")
      .map((attempt) => attempt.cellId),
  );
  const infrastructureFailure =
    options.attempt.infrastructureClassification === "session-infrastructure-error";
  return decodePhaseSummary({
    ...options.summary,
    state: infrastructureFailure
      ? "blocked"
      : successful.size === options.summary.plannedCells.length
        ? "complete"
        : "running",
    reservations,
    attempts,
    cumulativeActualTokens: attempts.reduce((sum, attempt) => sum + attempt.actualTokenUsage, 0),
    ...(infrastructureFailure
      ? {
          failure: {
            kind: "session-infrastructure-error",
            reservationId: options.reservationId,
            attemptId: options.attempt.attemptId,
            detail: "Frozen attempt contains a session infrastructure error.",
          },
        }
      : { failure: undefined }),
  });
}

function blockUnresolved(
  summary: PhaseSummary,
  reservationId: string,
  error: unknown,
): PhaseSummary {
  const detail = error instanceof Error ? error.message : String(error);
  return decodePhaseSummary({
    ...summary,
    state: "blocked",
    failure: {
      kind: "unresolved-reservation",
      reservationId,
      detail,
    },
  });
}

async function readAttempt(attemptRoot: string): Promise<AttemptSummary | undefined> {
  try {
    return decodeAttemptSummary(await readJsonObject(join(attemptRoot, "attempt.json")));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|missing or unreadable/.test(detail)) return undefined;
    throw error;
  }
}

export interface StudyCellLaunch {
  cell: PlannedCell;
  attemptId: string;
  attemptRoot: string;
  studyRootId: string;
  designDigest: string;
  tokenBudgetPerAgent: number;
  monetaryAuthorizationCeilingCents: number;
  replacementOfAttemptId?: string;
}

export interface StudyExecutionDependencies {
  beforeLaunch: (launch: StudyCellLaunch) => Promise<void>;
  runCell: (launch: StudyCellLaunch) => Promise<unknown>;
  now: () => Date;
}

const defaultExecutionDependencies: Pick<StudyExecutionDependencies, "now"> = {
  now: () => new Date(),
};

export class StudyPhaseStoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyPhaseStoppedError";
  }
}

export interface ExecuteStudyPhaseOptions {
  studyRoot: string;
  study: ResolvedStudy;
  receipt: DesignReceipt;
  phase: StudyPhase;
  replaceAttemptId?: string;
  dependencies: Omit<StudyExecutionDependencies, "now"> &
    Partial<Pick<StudyExecutionDependencies, "now">>;
}

export async function executeStudyPhase(options: ExecuteStudyPhaseOptions): Promise<PhaseSummary> {
  const studyRoot = resolve(options.studyRoot);
  const deps = { ...defaultExecutionDependencies, ...options.dependencies };
  let summary = await initializeStudyPhase({
    studyRoot,
    study: options.study,
    receipt: options.receipt,
    phase: options.phase,
  });
  if (summary.state === "complete") {
    if (options.replaceAttemptId !== undefined) {
      throw new Error("A complete phase has no unresolved replacement source.");
    }
    return summary;
  }
  if (summary.failure?.kind === "unresolved-reservation") {
    throw new Error(
      `Phase has unresolved launch ${summary.failure.reservationId}; use a new study root.`,
    );
  }
  if (summary.state === "blocked" && options.replaceAttemptId === undefined) {
    throw new Error(
      `Phase stopped at ${summary.failure?.attemptId ?? "an infrastructure attempt"}; an explicit --replace citation is required.`,
    );
  }

  const runOne = async (
    cell: PlannedCell,
    replacementOfAttemptId?: string,
  ): Promise<PhaseSummary> => {
    if (replacementOfAttemptId !== undefined) {
      await assertReplacementHeadroom(studyRoot, options.study, options.receipt);
    }
    const kind = replacementOfAttemptId === undefined ? "primary" : "replacement";
    const launchRoot = join(studyRoot, options.phase, "attempts");
    const previewOrdinal = summary.reservations.length + 1;
    const previewAttemptId = `attempt-${options.phase}-${String(cell.phasePosition).padStart(2, "0")}-${String(previewOrdinal).padStart(3, "0")}`;
    const preview: StudyCellLaunch = {
      cell,
      attemptId: previewAttemptId,
      attemptRoot: join(launchRoot, previewAttemptId),
      studyRootId: `study-${options.receipt.designDigest.slice(0, 16)}`,
      designDigest: options.receipt.designDigest,
      tokenBudgetPerAgent: options.study.budgets.tokenBudgetPerAgent,
      monetaryAuthorizationCeilingCents: options.study.budgets.perAttemptMonetaryCeilingCents,
      ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
    };
    await deps.beforeLaunch(preview);
    const reserved = reserveLaunch({
      summary,
      cell,
      study: options.study,
      kind,
      ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
      now: deps.now(),
    });
    if (reserved.attemptId !== preview.attemptId) {
      throw new Error("Launch identity changed between preflight and reservation.");
    }
    summary = reserved.summary;
    await publishPhaseSummary(studyRoot, summary);
    try {
      await deps.runCell(preview);
    } catch (error) {
      const durable = await readAttempt(preview.attemptRoot);
      if (durable === undefined) {
        summary = blockUnresolved(summary, reserved.reservationId, error);
        await publishPhaseSummary(studyRoot, summary);
        throw error;
      }
      assertAttemptMatchesLaunch({
        attempt: durable,
        attemptRoot: preview.attemptRoot,
        summary,
        cell,
        study: options.study,
        receipt: options.receipt,
        attemptId: preview.attemptId,
        ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
      });
      summary = indexAttempt({
        summary,
        reservationId: reserved.reservationId,
        cell,
        attemptRoot: preview.attemptRoot,
        attempt: durable,
      });
      await publishPhaseSummary(studyRoot, summary);
      if (durable.infrastructureClassification === "session-infrastructure-error") {
        throw new StudyPhaseStoppedError(
          `Phase stopped after infrastructure failure in ${durable.attemptId}.`,
        );
      }
      return summary;
    }
    const durable = await readAttempt(preview.attemptRoot);
    if (durable === undefined) {
      const error = new Error(`Attempt ${preview.attemptId} did not publish attempt.json.`);
      summary = blockUnresolved(summary, reserved.reservationId, error);
      await publishPhaseSummary(studyRoot, summary);
      throw error;
    }
    assertAttemptMatchesLaunch({
      attempt: durable,
      attemptRoot: preview.attemptRoot,
      summary,
      cell,
      study: options.study,
      receipt: options.receipt,
      attemptId: preview.attemptId,
      ...(replacementOfAttemptId === undefined ? {} : { replacementOfAttemptId }),
    });
    summary = indexAttempt({
      summary,
      reservationId: reserved.reservationId,
      cell,
      attemptRoot: preview.attemptRoot,
      attempt: durable,
    });
    await publishPhaseSummary(studyRoot, summary);
    if (durable.infrastructureClassification === "session-infrastructure-error") {
      throw new StudyPhaseStoppedError(
        `Phase stopped after infrastructure failure in ${durable.attemptId}.`,
      );
    }
    return summary;
  };

  if (options.replaceAttemptId !== undefined) {
    return runOne(replacementCell(summary, options.replaceAttemptId), options.replaceAttemptId);
  }
  while (successfulCellIds(summary).size < summary.plannedCells.length) {
    const cell = nextPrimaryCell(summary);
    if (cell === undefined) {
      throw new Error("Phase has no eligible next cell.");
    }
    await runOne(cell);
  }
  return summary;
}
