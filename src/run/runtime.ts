import { ActivityBus, type ActivityWaitResult } from "./activity.js";
import type { GitRefTarget, GitRefUpdate, GitRepositoryId } from "../git.js";
import type { AgentId } from "../model/contracts.js";
import type { ReleasedStage } from "./released-stage.js";
import { InfrastructureError } from "../sandbox/contracts.js";
import {
  TEAM_MESSAGE_MAX_CHARACTERS,
  TEAM_MESSAGE_PAGE_SIZE,
  type TeamMessage,
  type TeamMessagePage,
} from "./team-channel.js";

export interface AttemptRuntimeObservation {
  kind: "stage.released" | "git.changed" | "team.message";
  data: unknown;
  agentId?: AgentId;
}

export type AttemptRuntimeObserver = (
  observation: AttemptRuntimeObservation,
) => void | Promise<void>;

export interface AgentTeamChannel {
  post(message: string, signal?: AbortSignal): Promise<TeamMessage>;
  read(afterSequence: number): TeamMessagePage;
}

export interface AgentAttemptHandle {
  readonly agentId: AgentId;
  readonly latestActivitySequence: number;
  readonly teamChannel?: AgentTeamChannel;
  captureReleasedStages(): readonly Readonly<ReleasedStage>[];
  waitForActivity(afterSequence: number, signal?: AbortSignal): Promise<ActivityWaitResult>;
}

export class AttemptRuntimeInfrastructureError extends InfrastructureError {
  override readonly name = "AttemptRuntimeInfrastructureError";
  override readonly component = "attempt-runtime";
}

function abortError(): DOMException {
  return new DOMException("Attempt operation was cancelled.", "AbortError");
}

function frozenStage(stage: ReleasedStage): Readonly<ReleasedStage> {
  return Object.freeze({ ...stage });
}

export class AttemptRuntime {
  readonly #agentIds: readonly AgentId[];
  readonly #activities: Readonly<Record<AgentId, ActivityBus>>;
  readonly #releasedStages: Record<AgentId, Readonly<ReleasedStage>[]>;
  readonly #teamChannelEnabled: boolean;
  readonly #nowMs: () => number;
  readonly #observe: AttemptRuntimeObserver;
  readonly #onFatal: ((error: InfrastructureError) => void) | undefined;
  readonly #messages: TeamMessage[] = [];
  #traceTail: Promise<void> = Promise.resolve();
  #closingReason: string | undefined;
  #closePromise: Promise<void> | undefined;
  #endedReason: string | undefined;

  constructor(options: {
    agentIds: readonly AgentId[];
    teamChannelEnabled: boolean;
    nowMs: () => number;
    observe: AttemptRuntimeObserver;
    onFatal?: (error: InfrastructureError) => void;
  }) {
    if (
      options.agentIds.length === 0 ||
      new Set(options.agentIds).size !== options.agentIds.length
    ) {
      throw new Error("Attempt runtime requires unique agent IDs.");
    }
    this.#agentIds = Object.freeze([...options.agentIds]);
    this.#teamChannelEnabled = options.teamChannelEnabled;
    this.#nowMs = options.nowMs;
    this.#observe = options.observe;
    this.#onFatal = options.onFatal;
    this.#activities = Object.fromEntries(
      this.#agentIds.map((agentId) => [agentId, new ActivityBus(options.nowMs)]),
    ) as Record<AgentId, ActivityBus>;
    this.#releasedStages = Object.fromEntries(
      this.#agentIds.map((agentId) => [agentId, []]),
    ) as Record<AgentId, Readonly<ReleasedStage>[]>;
  }

  forAgent(agentId: AgentId): AgentAttemptHandle {
    const activity = this.#activityFor(agentId);
    const teamChannel = this.#teamChannelEnabled
      ? Object.freeze({
          post: (message: string, signal?: AbortSignal) =>
            this.#postTeamMessage(agentId, message, signal),
          read: (afterSequence: number) => this.#readTeamMessages(afterSequence),
        })
      : undefined;
    return Object.freeze({
      agentId,
      get latestActivitySequence() {
        return activity.latestSequence;
      },
      captureReleasedStages: () =>
        Object.freeze(this.#releasedFor(agentId).map((stage) => frozenStage(stage))),
      waitForActivity: (afterSequence: number, signal?: AbortSignal) =>
        activity.waitFor(afterSequence, signal),
      ...(teamChannel === undefined ? {} : { teamChannel }),
    });
  }

  async publishReleasedStage(
    agentId: AgentId,
    stage: ReleasedStage,
    publish: () => void,
  ): Promise<void> {
    this.#assertOpen();
    const released = this.#releasedFor(agentId);
    if (stage.ordinal !== released.length + 1) {
      throw new Error(
        `Released stages for ${agentId} are not contiguous at ${String(stage.ordinal)}.`,
      );
    }
    const activity = this.#activityFor(agentId);
    const activitySequence = activity.latestSequence + 1;
    try {
      publish();
    } catch (error) {
      const failure = new AttemptRuntimeInfrastructureError(
        `Unable to publish stage ${String(stage.ordinal)} for ${agentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
      this.#fail(failure);
      throw failure;
    }
    released.push(frozenStage(stage));
    const published = activity.publish({
      kind: "stage-released",
      detail: { ordinal: stage.ordinal, path: stage.visiblePath },
    });
    if (published.sequence !== activitySequence) {
      const failure = new AttemptRuntimeInfrastructureError(
        "Released-stage activity projection lost sequence consistency.",
      );
      this.#fail(failure);
      throw failure;
    }
    await this.#persistObservation({
      kind: "stage.released",
      data: {
        ordinal: stage.ordinal,
        path: stage.visiblePath,
        activitySequence,
      },
      agentId,
    });
  }

  async recordGitChange(
    repositoryId: GitRepositoryId,
    visibleAgentIds: readonly AgentId[],
    updatesOrRefs: readonly GitRefUpdate[] | readonly string[],
    targets?: readonly GitRefTarget[],
  ): Promise<void> {
    this.#assertOpen();
    if (
      visibleAgentIds.length === 0 ||
      new Set(visibleAgentIds).size !== visibleAgentIds.length ||
      visibleAgentIds.some((agentId) => !this.#agentIds.includes(agentId))
    ) {
      throw new Error("Git activity visibility must name unique attempt agents.");
    }
    const legacyRefs = typeof updatesOrRefs[0] === "string" || updatesOrRefs.length === 0;
    const frozenUpdates = legacyRefs
      ? undefined
      : Object.freeze(
          (updatesOrRefs as readonly GitRefUpdate[]).map(({ ref, before, after }) => {
            if (
              ref.trim() === "" ||
              (before !== null && !/^[0-9a-f]{40}$/.test(before)) ||
              (after !== null && !/^[0-9a-f]{40}$/.test(after))
            ) {
              throw new Error("Git ref updates must contain valid refs and object IDs.");
            }
            return Object.freeze({ ref, before, after });
          }),
        );
    const frozenRefs = Object.freeze(
      legacyRefs ? [...(updatesOrRefs as readonly string[])] : frozenUpdates!.map(({ ref }) => ref),
    );
    const observedTargets =
      targets ??
      frozenUpdates?.map(({ ref, after }) => ({
        ref,
        objectId: after,
      }));
    if (
      observedTargets !== undefined &&
      (observedTargets.length !== frozenRefs.length ||
        observedTargets.some(
          (target, index) =>
            target.ref !== frozenRefs[index] ||
            (target.objectId !== null && !/^[0-9a-f]{40}$/.test(target.objectId)),
        ))
    ) {
      throw new Error("Git ref targets must correspond to changed refs and contain object IDs.");
    }
    const frozenTargets =
      observedTargets === undefined
        ? undefined
        : Object.freeze(
            observedTargets.map(({ ref, objectId }) => Object.freeze({ ref, objectId })),
          );
    for (const agentId of visibleAgentIds) {
      this.#activityFor(agentId).publish({
        kind: "git-changed",
        detail: { repositoryId, refs: frozenRefs },
      });
    }
    await this.#persistObservation({
      kind: "git.changed",
      data: {
        repositoryId,
        refs: frozenRefs,
        ...(frozenTargets === undefined ? {} : { targets: frozenTargets }),
        ...(frozenUpdates === undefined ? {} : { updates: frozenUpdates }),
      },
    });
  }

  close(reason: string): Promise<void> {
    if (reason.trim().length === 0) {
      return Promise.reject(new Error("Attempt runtime close reason must be non-empty."));
    }
    if (this.#closePromise !== undefined) return this.#closePromise;
    if (this.#endedReason !== undefined) return Promise.resolve();
    this.#closingReason = reason;
    this.#closePromise = this.#traceTail.then(() => {
      if (this.#endedReason !== undefined) return;
      this.#endedReason = reason;
      for (const activity of Object.values(this.#activities)) {
        activity.end(reason);
      }
    });
    return this.#closePromise;
  }

  async #postTeamMessage(
    author: AgentId,
    content: string,
    signal?: AbortSignal,
  ): Promise<TeamMessage> {
    if (typeof content !== "string") {
      return Promise.reject(new Error("Team message must be text."));
    }
    const message = content.trim();
    if (message.length === 0) {
      return Promise.reject(new Error("Team message must contain non-whitespace text."));
    }
    if (message.length > TEAM_MESSAGE_MAX_CHARACTERS) {
      return Promise.reject(
        new Error(
          `Team message must contain at most ${String(TEAM_MESSAGE_MAX_CHARACTERS)} characters.`,
        ),
      );
    }
    this.#assertOpen();
    if (signal?.aborted) throw abortError();
    const occurredAtMs = this.#nowMs();
    if (!Number.isFinite(occurredAtMs) || occurredAtMs < 0) {
      throw new Error("Team message time must be a finite non-negative number.");
    }
    const accepted = Object.freeze({
      sequence: this.#messages.length + 1,
      author,
      message,
      occurredAtMs,
    });
    this.#messages.push(accepted);
    for (const activity of Object.values(this.#activities)) {
      activity.publish({
        kind: "team-message",
        detail: { messageSequence: accepted.sequence, author },
        occurredAtMs,
      });
    }
    await this.#persistObservation({ kind: "team.message", data: accepted });
    return accepted;
  }

  #readTeamMessages(afterSequence: number): TeamMessagePage {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Team message cursor must be a non-negative safe integer.");
    }
    const unseen = this.#messages.filter((message) => message.sequence > afterSequence);
    const messages = Object.freeze(unseen.slice(0, TEAM_MESSAGE_PAGE_SIZE));
    return {
      messages,
      latestSequence: this.#messages.at(-1)?.sequence ?? 0,
      nextSequence: messages.at(-1)?.sequence ?? afterSequence,
      hasMore: unseen.length > messages.length,
    };
  }

  #assertOpen(): void {
    const reason = this.#endedReason ?? this.#closingReason;
    if (reason !== undefined) {
      throw new Error(`Cannot mutate attempt runtime after the attempt ended: ${reason}.`);
    }
  }

  #persistObservation(observation: AttemptRuntimeObservation): Promise<void> {
    const persisted = this.#traceTail
      .then(() => this.#observe(observation))
      .catch((error: unknown) => {
        const failure =
          error instanceof InfrastructureError
            ? error
            : new AttemptRuntimeInfrastructureError(
                `Unable to persist ${observation.kind} to the canonical attempt trace: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                { cause: error },
              );
        this.#fail(failure);
        throw failure;
      });
    this.#traceTail = persisted;
    return persisted;
  }

  #fail(error: InfrastructureError): void {
    if (this.#endedReason !== undefined) return;
    this.#endedReason = "infrastructure-error";
    for (const activity of Object.values(this.#activities)) {
      activity.end(this.#endedReason);
    }
    this.#onFatal?.(error);
  }

  #activityFor(agentId: AgentId): ActivityBus {
    const activity = this.#activities[agentId];
    if (activity === undefined) throw new Error(`Unknown attempt agent ${agentId}.`);
    return activity;
  }

  #releasedFor(agentId: AgentId): Readonly<ReleasedStage>[] {
    const released = this.#releasedStages[agentId];
    if (released === undefined) throw new Error(`Unknown attempt agent ${agentId}.`);
    return released;
  }
}
