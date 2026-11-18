import { parse, type Logger } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type ThreadId,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type { PluginSetPort, PluginSetView, TraceReadPort } from "@fresnel/contracts/extensions";
import {
  AgentSpawnedPayloadSchema,
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  ProfileAppliedPayloadSchema,
  type DurableEventEnvelope,
} from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import {
  SCOPE_KINDS,
  type FrameMark,
  type RecordLevel,
  type ScopeKind,
  type TurnStatus,
} from "@fresnel/contracts/wire";
import type { MeasureStore } from "./store.ts";
import type { TrStepBatch } from "./turn-tables.ts";
import {
  flatHooksOf,
  hooksOfStep,
  type HookOwnerOf,
  MAX_HOOK_ROWS_PER_TURN,
  newDraft,
  stepAfterBoundary,
  stepRecordOf,
  stepRowOf,
  trFrameRowOf,
  trHookRowOf,
  turnRowOf,
  type TurnDraft,
  type TurnProfileMark,
  type TurnState,
} from "./turn-rows.ts";

// 턴 기록의 쓰는 쪽(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.1, §4.6). 커밋된 사건을 보고 턴 하나의 상태를 메모리에 모은다.
// 쓰기는 모두 `queue`로 넘겨 마이크로태스크의 묶음에서 실행한다(TX-09): 모델 호출 경로는 SQLite 쓰기를 기다리지 않는다.
// 턴은 `turn.started`에 `open` 행으로 열고, 단계가 끝날 때 그 단계의 행을 쓰고, `turn.completed`에 최종 상태로 닫는다.
// 계측이 꺼진 턴은 턴 행만 쓴다(`log_only`, 규칙 3). 켜진 턴은 단계 행과 훅 행을 쓴다(`full`).
// 프로필 표지(§4.10 규칙 60~63)는 커밋된 사건으로 정한다. 대화의 저장 id(`thread.started`·`thread.updated`), 마지막 적용(`profile.applied`),
// 하위 대화(`agent.spawned`)를 기억하고, 턴 시작 값이 없을 때만 포트(`PluginSetPort.resolve`)를 읽는다.

/** 아직 끝나지 않은 턴의 상태를 쥐는 상한. 넘으면 가장 먼저 연 턴부터 버린다(그 턴의 행은 `open`으로 남고 다음 열기 때 `lost`가 된다) */
const MAX_OPEN_TURNS = 64;
/** 대화별 프로필 상태를 쥐는 상한. 넘으면 가장 먼저 들어온 대화부터 뺀다 */
const MAX_TRACKED_THREADS = 500;
/** 저장한 프로필이 없을 때 쓰는 기본 프로필 id(M5c §4.1.1) */
const PROFILE_DEFAULT_ID = "default";

type StoreOp = (store: MeasureStore) => void;

/** 같은 키를 맨 뒤로 넣고, 상한을 넘으면 가장 먼저 들어온 것부터 뺀다 */
function rememberBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size <= MAX_TRACKED_THREADS) return;
  const oldest = map.keys().next();
  if (oldest.done !== true) map.delete(oldest.value);
}

/** `rememberBounded`의 집합판 */
function addBounded<K>(set: Set<K>, key: K): void {
  set.delete(key);
  set.add(key);
  if (set.size <= MAX_TRACKED_THREADS) return;
  const oldest = set.values().next();
  if (oldest.done !== true) set.delete(oldest.value);
}

/**
 * 포트 값에서 저장한 프로필 id를 되짚는다. 저장한 프로필이 없으면 `missingProfileId`다.
 * 저장한 id가 `default`였는지는 포트 값으로 가릴 수 없어 null(기본)로 둔다
 */
function storedIdOf(view: PluginSetView | undefined): string | null {
  if (view === undefined) return null;
  return view.missingProfileId ?? (view.profileId === PROFILE_DEFAULT_ID ? null : view.profileId);
}

export interface TurnWriterDeps {
  readonly store: MeasureStore;
  readonly trace: Pick<TraceReadPort, "turn"> | undefined;
  /** 대화의 프로필 포트(`PluginSetPortKey`). 기록기를 켠 뒤에 처음 보는 대화의 턴 시작 값을 채울 때만 읽는다 */
  readonly pluginSet: (() => Pick<PluginSetPort, "resolve"> | undefined) | undefined;
  /** 계측 켬 여부(`x.operations.trace.enabled`의 현재 값). 턴을 처음 볼 때 한 번 읽는다(규칙 6) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
  /** 쓰기를 묶음에 넣는다. 마이크로태스크에서 넣은 순서대로 실행된다 */
  readonly queue: (op: StoreOp) => void;
  /** 훅 행의 플러그인과 검토본 해시를 정하는 조회. 행을 쓰는 순간(단계 끝, 턴 끝)에 읽는다 */
  readonly hookOwner: HookOwnerOf;
}

export interface TurnWriter {
  /** 커밋된 사건 한 건. 턴 시작, 단계 끝, 턴 끝만 본다 */
  event(record: DurableEventEnvelope): void;
  /** 모델 호출 한 번(사용량 합산기). 단계의 모델 호출을 모은다 */
  usage(call: UsageRecord): void;
  /** 대화를 지운다. 이 대화의 열린 턴 상태를 버린다. 대기 중인 쓰기는 호출자가 먼저 비운다 */
  forget(threadId: string): void;
}

/** 범위 표지를 대화의 `tr_thread`에서 읽는다. 표지가 없거나 읽지 못하면 `live`다(§4.6 규칙 31) */
function scopeOf(store: MeasureStore, threadId: string, logger: Logger): ScopeKind {
  const found = store.getThread(threadId);
  if (!found.ok) {
    logger.warn("measure.scope_read_failed", { reason: found.error.kind });
    return "live";
  }
  const kind = found.value?.scopeKind;
  if (kind === undefined) return "live";
  return SCOPE_KINDS.find((candidate) => candidate === kind) ?? "live";
}

export function createTurnWriter(deps: TurnWriterDeps): TurnWriter {
  /** 열려 있는 턴. 끝나면(`turn.completed`) 지운다 */
  const drafts = new Map<string, TurnDraft>();
  /** 대화별로 열려 있는 주도권 프레임(`lease.acquired` 뒤 `lease.released` 전). 아래에서 위 순서다. 턴과 무관하게 이어진다 */
  const openFrames = new Map<string, FrameMark[]>();
  /** 대화가 저장한 프로필 id(`thread.started`·`thread.updated`의 `profileId`). 저장하지 않았으면 null. 모르는 대화는 키가 없다 */
  const storedProfiles = new Map<string, string | null>();
  /** 대화마다 마지막으로 적용된 프로필(`profile.applied`) */
  const appliedProfiles = new Map<
    string,
    { readonly profileId: string; readonly profileRev: number }
  >();
  /** 하위 대화 id(`agent.spawned`의 `childThreadId`). 이 대화의 턴 표지는 `inherited`다(§4.4 규칙 24) */
  const childThreads = new Set<string>();

  function levelNow(): RecordLevel {
    return deps.enabled() ? "full" : "log_only";
  }

  /**
   * 턴 시작의 프로필 표지(§4.10 규칙 60~62). 마지막 `profile.applied`가 시작 값이다. 없으면 포트가 주는 현재 값이고,
   * 포트도 없으면 `default`와 개정 0이다. 쓰인 프로필이 저장한 id와 같으면 `thread`, 아니면 `builtin`이다
   */
  function profileAtStart(threadId: ThreadId): TurnProfileMark {
    const applied = appliedProfiles.get(threadId);
    // 적용된 값이 없거나 저장한 id를 모르면 포트의 현재 값을 본다(포트가 없으면 undefined)
    const view =
      applied === undefined || !storedProfiles.has(threadId)
        ? deps.pluginSet?.()?.resolve(threadId)
        : undefined;
    const storedId = storedIdFor(threadId, applied, view);
    const id = applied?.profileId ?? view?.profileId ?? storedId ?? PROFILE_DEFAULT_ID;
    return {
      id,
      rev: applied?.profileRev ?? view?.profileRev ?? 0,
      source: storedId !== null && storedId === id ? "thread" : "builtin",
      inherited: childThreads.has(threadId),
    };
  }

  /**
   * 대화가 저장한 프로필 id. 기록한 값이 있으면 그것이고, 없으면 포트 값에서 되짚고, 포트도 없으면 적용된 값에서 되짚는다.
   * 기본이 아닌 프로필은 저장한 id로만 쓰이므로 적용된 id가 `default`가 아니면 그것이 저장한 id다
   */
  function storedIdFor(
    threadId: ThreadId,
    applied: { readonly profileId: string } | undefined,
    view: PluginSetView | undefined,
  ): string | null {
    const stored = storedProfiles.get(threadId);
    if (stored !== undefined) return stored;
    if (view !== undefined) return storedIdOf(view);
    if (applied !== undefined && applied.profileId !== PROFILE_DEFAULT_ID) return applied.profileId;
    return null;
  }

  /** 저장한 프로필 id를 기억한다. 턴과 무관하다 */
  function rememberStored(record: DurableEventEnvelope): void {
    if (record.kind === "thread.started") {
      const parsed = parse(ThreadStartedPayloadSchema, record.payload);
      if (parsed.ok)
        rememberBounded(storedProfiles, record.threadId, parsed.value.profileId ?? null);
      return;
    }
    const parsed = parse(ThreadUpdatedPayloadSchema, record.payload);
    if (parsed.ok && parsed.value.profileId !== undefined) {
      rememberBounded(storedProfiles, record.threadId, parsed.value.profileId);
    }
  }

  /** 적용된 프로필을 기억하고, 턴 안의 경계에서 개정이 시작 값(또는 직전 바뀜)과 달라졌으면 턴 기록에 적는다(§4.10 규칙 63) */
  function profileApplied(record: DurableEventEnvelope): void {
    const parsed = parse(ProfileAppliedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    const { profileId, profileRev } = parsed.value;
    rememberBounded(appliedProfiles, record.threadId, { profileId, profileRev });
    if (record.turnId === null) return;
    const draft = drafts.get(record.turnId);
    if (draft === undefined) return;
    const current = draft.profileRevChanges.at(-1)?.rev ?? draft.profile.rev;
    if (profileRev === current) return;
    draft.profileRevChanges.push({
      stepIndex: stepAfterBoundary(draft.lastStepIndex),
      rev: profileRev,
    });
  }

  /** 하위 대화를 기억한다. `agent.spawned`는 자식의 첫 턴보다 먼저 커밋된다 */
  function rememberChild(record: DurableEventEnvelope): void {
    const parsed = parse(AgentSpawnedPayloadSchema, record.payload);
    if (parsed.ok) addBounded(childThreads, parsed.value.childThreadId);
  }

  /** 이 대화에서 지금 열려 있는 턴(있으면 하나) */
  function openDraftOf(threadId: string): TurnDraft | undefined {
    for (const draft of drafts.values()) if (draft.threadId === threadId) return draft;
    return undefined;
  }

  /**
   * 프레임 사건을 따른다(drive-isolation.md 2.6, 턴 기록 §4.9 규칙 23). `lease.acquired`는 프레임을 쌓고, `lease.released`는 내린다.
   * 깊이는 코어를 0으로 센다(`lease.acquired.depth`는 코어 위 첫 프레임이 0이라 1을 더한다).
   * 한도 소비량, 사용자 메시지 수, `lowerResumedWith`는 사건에 실리지 않아 0과 null이다
   */
  function frameEvent(record: DurableEventEnvelope): void {
    const draft = openDraftOf(record.threadId);
    const sinceStart = (): number => Math.max(0, record.recordedAt - (draft?.startedAt ?? 0));
    if (record.kind === "lease.acquired") {
      const parsed = parse(LeaseAcquiredPayloadSchema, record.payload);
      if (!parsed.ok) return;
      const { leaseId, scopeId, limits, parent, depth, contentHash } = parsed.value;
      const frame: FrameMark = {
        depth: (depth ?? 0) + 1,
        plugin: scopeId,
        versionId: contentHash ?? null,
        leaseId,
        parentLeaseId: parent ?? null,
        enteredAtMs: sinceStart(),
        exitedAtMs: null,
        exitReason: null,
        lowerResumedWith: null,
        limits,
        used: { turns: 0, spawns: 0, tokens: 0 },
        userMessages: 0,
      };
      const stack = openFrames.get(record.threadId) ?? [];
      rememberBounded(openFrames, record.threadId, [...stack, frame]);
      draft?.frames.push({ ...frame });
      return;
    }
    const parsed = parse(LeaseReleasedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    const { leaseId, reason } = parsed.value;
    const stack = openFrames.get(record.threadId);
    if (stack !== undefined) {
      rememberBounded(
        openFrames,
        record.threadId,
        stack.filter((frame) => frame.leaseId !== leaseId),
      );
    }
    const mark = draft?.frames.findIndex((frame) => frame.leaseId === leaseId) ?? -1;
    const found = draft?.frames[mark];
    if (draft !== undefined && found !== undefined) {
      draft.frames[mark] = { ...found, exitedAtMs: sinceStart(), exitReason: reason };
    }
  }

  function remember(draft: TurnDraft): void {
    drafts.set(draft.turnId, draft);
    if (drafts.size <= MAX_OPEN_TURNS) return;
    const oldest = drafts.keys().next();
    if (oldest.done !== true) drafts.delete(oldest.value);
  }

  /** 턴 행 하나를 쓴다. 범위는 쓰는 때마다 대화의 표지에서 다시 읽는다 */
  function writeTurnRow(
    store: MeasureStore,
    draft: TurnDraft,
    state: TurnState,
    phase: "open" | "closed",
  ): void {
    draft.scope = scopeOf(store, draft.threadId, deps.logger);
    const written = store.upsertTurn(turnRowOf(draft, state));
    if (!written.ok) {
      deps.logger.warn("measure.turn_write_failed", { reason: written.error.kind, phase });
    }
  }

  function turnStarted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(TurnStartedPayloadSchema, record.payload);
    const origin = parsed.ok && parsed.value.origin !== undefined ? parsed.value.origin : "user";
    // 같은 턴을 두 번 열지 않는다(방어)
    if (drafts.has(turnId)) return;
    const draft = newDraft({
      threadId: record.threadId,
      turnId,
      startedAt: record.recordedAt,
      startedEventId: record.id,
      origin,
      level: levelNow(),
      profile: profileAtStart(record.threadId),
    });
    // 턴 시작 때 열려 있던 스택. 턴 전에 들어온 프레임은 들어온 시각이 0이다
    for (const frame of openFrames.get(record.threadId) ?? []) {
      draft.frames.push({ ...frame, enteredAtMs: 0 });
    }
    remember(draft);
    deps.queue((store) => {
      writeTurnRow(
        store,
        draft,
        { status: "open", endedAt: null, complete: false, turnHooks: [] },
        "open",
      );
    });
  }

  /** 처음 보는 턴(기록기를 켜기 전에 턴이 시작된 경우)을 단계 끝이나 턴 끝에서 만든다. 열린 행은 쓰지 않는다 */
  function draftOf(record: DurableEventEnvelope, turnId: TurnId): TurnDraft {
    const known = drafts.get(turnId);
    if (known !== undefined) return known;
    const draft = newDraft({
      threadId: record.threadId,
      turnId,
      startedAt: record.recordedAt,
      startedEventId: null,
      origin: "user",
      level: levelNow(),
      profile: profileAtStart(record.threadId),
    });
    remember(draft);
    return draft;
  }

  function stepCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(StepCompletedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    const draft = draftOf(record, turnId);
    const { stepIndex, composition } = parsed.value;
    // 프로필 경계가 가리키는 다음 단계를 정한다. 계측이 꺼진 턴도 턴 행의 프로필 변화에 필요하다
    draft.lastStepIndex = stepIndex;
    // 계측이 꺼진 턴은 단계 행을 쓰지 않는다(규칙 3: 턴 행만)
    if (draft.level !== "full") return;
    const stepId = record.stepId ?? `step:${String(stepIndex)}`;
    // 단계 끝의 훅(`boundary.step.after`, `boundary.settle.before`)은 이 커밋 전에 실행되어 이미 버퍼에 있다
    const entries = deps.trace?.turn(record.threadId, turnId)?.entries ?? [];
    const hooks = hooksOfStep(
      flatHooksOf(entries),
      stepIndex,
      MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
      deps.hookOwner,
    );
    draft.hookRows += hooks.rows.length;
    draft.elidedHooks += hooks.elided;
    const step = stepRecordOf({
      stepIndex,
      stepId,
      turnStartedAt: draft.startedAt,
      calls: draft.calls.get(stepId) ?? [],
      composition: composition ?? null,
      hooks: hooks.rows.map((row) => row.run),
    });
    draft.steps.push(step);
    const batch: TrStepBatch = {
      step: stepRowOf({
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepIndex,
        calls: step.modelCalls,
      }),
      calls: [],
      hooks: hooks.rows.map((row) =>
        trHookRowOf(row, { threadId: draft.threadId, turnId: draft.turnId, stepIndex }),
      ),
      materials: [],
      tooluse: [],
      skills: [],
      plugincalls: [],
      cache: [],
    };
    deps.queue((store) => {
      const written = store.writeStep(batch);
      if (written.ok) return;
      draft.writeFailures += 1;
      deps.logger.warn("measure.step_write_failed", {
        reason: written.error.kind,
        stepIndex,
      });
    });
  }

  function turnCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(TurnCompletedPayloadSchema, record.payload);
    const status: TurnStatus = parsed.ok ? parsed.value.status : "failed";
    const draft = draftOf(record, turnId);
    drafts.delete(turnId);
    const full = draft.level === "full";
    // 단계 밖 훅(턴 경계)은 `record_json`의 `turnHooks`에만 든다. 행으로는 쓰지 않는다(§4.1 규칙 15의 남은 일)
    const turnHooks = full
      ? hooksOfStep(
          flatHooksOf(deps.trace?.turn(record.threadId, turnId)?.entries ?? []),
          0,
          MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
          deps.hookOwner,
        ).rows.map((row) => row.run)
      : [];
    const endedAt = record.recordedAt;
    const frameRows = (full ? draft.frames : []).flatMap((frame) => {
      const row = trFrameRowOf({ threadId: draft.threadId, turnId: draft.turnId }, frame);
      return row === null ? [] : [row];
    });
    deps.queue((store) => {
      if (frameRows.length > 0) {
        const written = store.writeFrames(frameRows);
        if (!written.ok) {
          draft.writeFailures += 1;
          deps.logger.warn("measure.frame_write_failed", { reason: written.error.kind });
        }
      }
      // 단계 쓰기가 하나라도 실패했으면 턴은 불완전하다. 계측이 꺼진 턴도 단계 기록이 없으므로 불완전하다
      const complete = full && draft.writeFailures === 0;
      writeTurnRow(store, draft, { status, endedAt, complete, turnHooks }, "closed");
    });
  }

  return {
    event(record) {
      if (record.kind === "profile.applied") profileApplied(record);
      else if (record.kind === "thread.started" || record.kind === "thread.updated") {
        rememberStored(record);
      } else if (record.kind === "agent.spawned") rememberChild(record);
      else if (record.kind === "lease.acquired" || record.kind === "lease.released") {
        frameEvent(record);
      }
      const turnId = record.turnId;
      if (turnId === null) return;
      if (record.kind === "turn.started") turnStarted(record, turnId);
      else if (record.kind === "step.completed") stepCompleted(record, turnId);
      else if (record.kind === "turn.completed") turnCompleted(record, turnId);
    },
    usage(call) {
      if (call.turnId === null || call.stepId === null) return;
      const draft = drafts.get(call.turnId);
      if (draft === undefined || draft.level !== "full") return;
      const calls = draft.calls.get(call.stepId) ?? [];
      calls.push(call);
      draft.calls.set(call.stepId, calls);
    },
    forget(threadId) {
      for (const [turnId, draft] of drafts) {
        if (draft.threadId === threadId) drafts.delete(turnId);
      }
      storedProfiles.delete(threadId);
      appliedProfiles.delete(threadId);
      childThreads.delete(threadId);
      openFrames.delete(threadId);
    },
  };
}
