import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

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
import {
  buildAgentPrompt,
  CUTOFF_MS_PLACEHOLDER,
  snapshotAgentPromptTemplates,
  TOKEN_BUDGET_PLACEHOLDER,
  type PromptAgentId,
} from "./prompt.js";
import { readJsonObject } from "./python.js";
import { createDockerCommandSandbox } from "./sandbox/container.js";
import { SANDBOX_POLICY, type SandboxIdentity } from "./sandbox/contracts.js";
import { sealTree, verifyTree } from "./seal.js";
import { JsonlObservationLog } from "./trace.js";

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

function authorizedTokens(tokenBudgetPerAgent: number | null): number | null {
  return tokenBudgetPerAgent === null
    ? null
    : checkedProduct(tokenBudgetPerAgent, AGENT_COUNT, "Attempt token authorization");
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
  return {
    blockId,
    buildRoot,
    buildManifestDigest: sha256(bytes),
    treeSeal: await sealTree(buildRoot),
    manifest,
  };
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
  phase: StudyPhase;
  dependencies: StudyDesignDependencies;
}): Promise<readonly DesignBuildBinding[]> {
  const buildsRoot = join(options.studyRoot, "builds");
  await mkdir(buildsRoot, { recursive: true });
  const bindings: DesignBuildBinding[] = [];
  for (const block of options.study.blocks.filter(
    (candidate) => candidate.phase === options.phase,
  )) {
    const buildRoot = join(buildsRoot, block.blockId);
    await options.dependencies.build({
      root: options.root,
      output: buildRoot,
      source: join(options.root, block.sourcePath),
      phase: block.phase,
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
  const snapshots = snapshotAgentPromptTemplates(study.communication.teamChannel);
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
        cutoffMs: study.schedule.cutoffMs,
        tokenBudgetPerAgent,
        teamChannel: study.communication.teamChannel,
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
    tokenBudgetPerAgent: number | null;
    perAttemptMonetaryCeilingCents: number;
  };
}): DesignReceipt {
  const baselineBudgets = options.baselineBudgets ?? options.study.budgets;
  const prompts = promptBindings(options.study, baselineBudgets.tokenBudgetPerAgent);
  const identity = {
    schemaVersion: 3,
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
    checking: options.study.checking,
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
    tokenBudgetPerAgent: number | null;
    perAttemptMonetaryCeilingCents: number;
  },
  replacementAuthorization: { tokens: number; cents: number } = {
    tokens: 0,
    cents: 0,
  },
  includeValidation = false,
): void {
  const calibrationAttemptTokens = authorizedTokens(receipt.baselineBudgets.tokenBudgetPerAgent);
  const validationAttemptTokens = authorizedTokens(validationBudgets.tokenBudgetPerAgent);
  const calibrationMoney = checkedProduct(
    CALIBRATION_CELL_COUNT,
    receipt.baselineBudgets.perAttemptMonetaryCeilingCents,
    "Calibration primary monetary authorization",
  );
  const validationMoney = includeValidation
    ? checkedProduct(
        VALIDATION_CELL_COUNT,
        validationBudgets.perAttemptMonetaryCeilingCents,
        "Validation primary monetary authorization",
      )
    : 0;
  const tokenPolicyDisabled = receipt.totalCeilings.tokens === null;
  if (
    tokenPolicyDisabled !== (calibrationAttemptTokens === null) ||
    tokenPolicyDisabled !== (validationAttemptTokens === null)
  ) {
    throw new Error("Study token policy must remain consistent with its total token ceiling.");
  }
  if (
    !tokenPolicyDisabled &&
    checkedProduct(
      CALIBRATION_CELL_COUNT,
      calibrationAttemptTokens!,
      "Calibration primary token authorization",
    ) +
      (includeValidation
        ? checkedProduct(
            VALIDATION_CELL_COUNT,
            validationAttemptTokens!,
            "Validation primary token authorization",
          )
        : 0) +
      replacementAuthorization.tokens >
      receipt.totalCeilings.tokens!
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
      !sameValue(actual.treeSeal, expected.treeSeal) ||
      !sameValue(actual.manifest, expected.manifest)
    ) {
      throw new Error(`Receipt-bound build ${expected.blockId} has drifted.`);
    }
    bindings.push(actual);
  }
  return bindings;
}

async function assertCellBuildBinding(receipt: DesignReceipt, cell: PlannedCell): Promise<void> {
  const expected = receipt.builds.find((binding) => binding.blockId === cell.blockId);
  if (
    expected === undefined ||
    resolve(expected.buildRoot) !== cell.buildRoot ||
    selectBuildVariant(expected.manifest, resolveCondition(cell.condition).variantId).buildId !==
      cell.buildId
  ) {
    throw new Error(`Study cell ${cell.cellId} does not match its receipt-bound build.`);
  }
  const actual = await readBuildBinding(cell.buildRoot, cell.blockId);
  if (
    actual.buildManifestDigest !== expected.buildManifestDigest ||
    !sameValue(actual.treeSeal, expected.treeSeal) ||
    !sameValue(actual.manifest, expected.manifest)
  ) {
    throw new Error(`Receipt-bound build ${cell.blockId} has drifted before launch.`);
  }
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
    : await prepareBuilds({
        root,
        studyRoot,
        study: options.study,
        phase: options.phase,
        dependencies: deps,
      });
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
  assertPrimaryAuthorization(
    expected,
    expected.baselineBudgets,
    undefined,
    options.phase === "validation",
  );
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
    schemaVersion: 2,
    phase,
    state: "ready",
    manifestDigest: study.manifestDigest,
    immutableManifestDigest: study.immutableManifestDigest,
    designDigest: receipt.designDigest,
    plannedCells: cells,
    adjustments,
    reservations: [],
    attempts: [],
    cumulativeAuthorizedTokens: study.budgets.tokenBudgetPerAgent === null ? null : 0,
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
    options.phase === "validation",
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
        total.tokens += reservation.authorizedTokens ?? 0;
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
  const validation = await readPhaseIfPresent(studyRoot, "validation");
  const authorization = replacementAuthorization([
    await readPhaseIfPresent(studyRoot, "calibration"),
    validation,
  ]);
  assertPrimaryAuthorization(
    receipt,
    study.budgets,
    {
      tokens: authorization.tokens + (authorizedTokens(study.budgets.tokenBudgetPerAgent) ?? 0),
      cents: authorization.cents + study.budgets.perAttemptMonetaryCeilingCents,
    },
    validation !== undefined,
  );
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
      cumulativeAuthorizedTokens:
        options.study.budgets.tokenBudgetPerAgent === null
          ? null
          : reservations.reduce((sum, item) => sum + item.authorizedTokens!, 0),
      cumulativeAuthorizedMonetaryCents: reservations.reduce(
        (sum, item) => sum + item.monetaryAuthorizationCeilingCents,
        0,
      ),
      failure: undefined,
    }),
  };
}

async function assertAttemptTrace(attempt: AttemptSummary, attemptRoot: string): Promise<void> {
  const root = resolve(attemptRoot);
  const tracePath = join(root, "trace.jsonl");
  const traceMetadataPath = join(root, "trace.meta.json");
  if (
    resolve(attempt.tracePath) !== tracePath ||
    resolve(attempt.traceMetadataPath) !== traceMetadataPath
  ) {
    throw new Error(`Attempt ${attempt.attemptId} does not reference its canonical trace files.`);
  }
  try {
    await JsonlObservationLog.open(tracePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Attempt ${attempt.attemptId} trace is missing or invalid: ${detail}`);
  }
}

async function assertAttemptMatchesLaunch(options: {
  attempt: AttemptSummary;
  attemptRoot: string;
  summary: PhaseSummary;
  cell: PlannedCell;
  study: ResolvedStudy;
  receipt: DesignReceipt;
  attemptId: string;
  replacementOfAttemptId?: string;
  budgets?: {
    tokenBudgetPerAgent: number | null;
    perAttemptMonetaryCeilingCents: number;
  };
}): Promise<void> {
  const attempt = options.attempt;
  const budgets = options.budgets ?? options.study.budgets;
  const condition = resolveCondition(options.cell.condition);
  const models = options.study.assignment.map((assignment) => {
    const profile = options.study.models[assignment.modelProfileId];
    if (profile === undefined) {
      throw new Error(`Study model profile ${assignment.modelProfileId} is missing.`);
    }
    const provider = options.study.providers[profile.provider];
    if (provider === undefined) {
      throw new Error(`Study provider ${profile.provider} is missing.`);
    }
    return {
      agentId: assignment.agentId,
      model: {
        profile: assignment.modelProfileId,
        provider: profile.provider,
        driver: provider.driver,
        requestedModel: profile.model,
        settings: profile.settings,
        providerOptions: profile.providerOptions,
      },
    };
  });
  const prompts = options.study.assignment.map(({ agentId }) => {
    const template = options.receipt.promptTemplates.find(
      (candidate) =>
        candidate.agentId === agentId &&
        candidate.communicationMode === condition.communicationMode,
    );
    if (
      template === undefined ||
      template.template.split(TOKEN_BUDGET_PLACEHOLDER).length !== 2 ||
      template.template.split(CUTOFF_MS_PLACEHOLDER).length !== 2
    ) {
      throw new Error(`Receipt prompt template for ${agentId} is invalid.`);
    }
    return {
      agentId,
      prompt: buildAgentPrompt({
        agentId,
        condition: condition.id,
        cutoffMs: options.study.schedule.cutoffMs,
        tokenBudgetPerAgent: budgets.tokenBudgetPerAgent,
        teamChannel: options.study.communication.teamChannel,
      }),
    };
  });
  const expectedProtocol = {
    schemaVersion: 3,
    blockId: options.cell.blockId,
    condition: condition.id,
    communicationMode: condition.communicationMode,
    keyRegime: condition.keyRegime,
    variantId: condition.variantId,
    buildId: options.cell.buildId,
    releaseOffsetsMs: options.study.schedule.releaseOffsetsMs,
    cutoffMs: options.study.schedule.cutoffMs,
    tokenBudgetPerAgent: budgets.tokenBudgetPerAgent,
    teamChannel: options.study.communication.teamChannel,
    models,
    prompts,
    sandbox: options.receipt.sandbox,
  };
  const build = options.receipt.builds.find(
    (candidate) => candidate.blockId === options.cell.blockId,
  );
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
  if (build === undefined || !sameValue(attempt.buildTreeSeal, build.treeSeal)) {
    throw new Error(`Attempt ${attempt.attemptId} does not use its receipt-bound build tree.`);
  }
  if (!sameValue(attempt.protocol, expectedProtocol)) {
    throw new Error(`Attempt ${attempt.attemptId} does not match the frozen study protocol.`);
  }
  if (resolve(options.attemptRoot) === options.cell.buildRoot) {
    throw new Error("Attempt root cannot overlap its receipt-bound build root.");
  }
  await assertAttemptTrace(attempt, options.attemptRoot);
  await verifyTree(
    attempt.frozen.root,
    attempt.frozen.treeSeal,
    `Attempt ${attempt.attemptId} frozen tree`,
  );
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
    await assertAttemptMatchesLaunch({
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
  tokenBudgetPerAgent: number | null;
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

async function acquirePhaseExecutionLock(
  studyRoot: string,
  phase: StudyPhase,
): Promise<() => Promise<void>> {
  const path = join(studyRoot, phase, ".execution.lock");
  await mkdir(join(studyRoot, phase), { recursive: true });
  try {
    await writeFile(path, "", { flag: "wx" });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error(
        "Phase execution lock already exists; another coordinator may be running or an earlier execution stopped ambiguously. Use a new study root.",
      );
    }
    throw error;
  }
  return async () => rm(path, { force: true });
}

export async function executeStudyPhase(options: ExecuteStudyPhaseOptions): Promise<PhaseSummary> {
  const studyRoot = resolve(options.studyRoot);
  const release = await acquirePhaseExecutionLock(studyRoot, options.phase);
  try {
    return await executeLockedStudyPhase(options, studyRoot);
  } finally {
    await release();
  }
}

async function executeLockedStudyPhase(
  options: ExecuteStudyPhaseOptions,
  studyRoot: string,
): Promise<PhaseSummary> {
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
    await assertCellBuildBinding(options.receipt, cell);
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
      await assertAttemptMatchesLaunch({
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
    await assertAttemptMatchesLaunch({
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
