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
import type {
  ContextTraceEvent,
  PluginCallTraceEvent,
  PluginSetPort,
  PluginSetView,
  ToolCallTraceEvent,
  TraceReadPort,
  TurnBlockEvent,
} from "@fresnel/contracts/extensions";
import {
  AgentSpawnedPayloadSchema,
  InputQueuedPayloadSchema,
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  ProfileAppliedPayloadSchema,
  type DurableEventEnvelope,
} from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import {
  PluginCallLineSchema,
  SCOPE_KINDS,
  type DeltaRow,
  type FrameMark,
  type RecordLevel,
  type ScopeKind,
  type TurnStatus,
} from "@fresnel/contracts/wire";
import { draftVersionIdOf } from "@fresnel/ext-host";
import type { MeasureStore } from "./store.ts";
import { decodeTestRunDrafts } from "./test-run-marks.ts";
import type { TurnRecordEvent, TurnRecordEvents } from "./turn-events.ts";
import {
  advertisedRecordOf,
  blockMaterialsOf,
  cacheBreakOf,
  MAX_MATERIAL_ROWS_PER_TURN,
  MAX_SKILL_ROWS_PER_TURN,
  materialKeyOf,
  materialPlanOf,
  materialsFingerprintOf,
  nameOf,
  noteToolRows,
  trCacheRowsOf,
  trMaterialRowOf,
  trToolUseRowOf,
  withBlockFact,
  type CacheUsage,
} from "./turn-context.ts";
import type { TrSkillRow, TrStepBatch, TrToolUseRow, TrTurnRow } from "./turn-tables.ts";
import {
  callRecordOf,
  flatHooksOf,
  hookKeyOf,
  hooksOfStep,
  isTurnLevelHook,
  lateHooksOf,
  MAX_CALL_ROWS_PER_TURN,
  MAX_HOOK_ROWS_PER_TURN,
  MAX_PLUGIN_CALL_ROWS_PER_TURN,
  maskedArgTokensOf,
  newDraft,
  pluginCallLineOf,
  stepAfterBoundary,
  stepRecordOf,
  stepRowOf,
  trCallRowOf,
  trFrameRowOf,
  trHookRowOf,
  trPluginCallRowOf,
  turnRowOf,
  type TurnDraft,
  type TurnProfileMark,
  type TurnState,
  type TurnTestRunMark,
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
  /** 쓰인 행을 알린다(읽기 전용 사건). 없으면 아무것도 하지 않는다 */
  readonly events?: Pick<TurnRecordEvents, "emit">;
  /** 한 턴 `record_json`의 상한(바이트, `x.operations.trace.maxTurnBytes`의 현재 값). 턴을 처음 볼 때 한 번 읽는다 */
  readonly maxTurnBytes: () => number;
  /** 테스트 실행 대화를 계측이 꺼져도 기록할지(`x.operations.trace.testRunsAlwaysOn`의 현재 값). 턴을 처음 볼 때 한 번 읽는다 */
  readonly testRunsAlwaysOn: () => boolean;
}

export interface TurnWriter {
  /** 커밋된 사건 한 건. 턴 시작, 단계 끝, 턴 끝만 본다 */
  event(record: DurableEventEnvelope): void;
  /** 모델 호출 한 번(사용량 합산기). 단계의 모델 호출을 모은다 */
  usage(call: UsageRecord): void;
  /** 도구 호출 하나가 닫힌 줄(추적 싱크). 계측이 켜진 턴의 단계에 모은다. 반환값은 호출 경로로 돌아가지 않는다 */
  call(event: ToolCallTraceEvent): void;
  /**
   * 가벼운 길의 플러그인 호출 한 줄(추적 싱크). 가드는 턴을 모르므로 이 대화의 열린 턴에 붙인다.
   * 열린 턴이 없거나 계측이 꺼진 턴이면 버린다. 줄은 턴을 닫을 때 한 묶음으로 쓴다
   */
  pluginCall(event: PluginCallTraceEvent): void;
  /** 조립 재료·광고(`step_context`)와 스킬 본문 읽기(`skill_read`)의 읽기 전용 사건. 단계가 끝날 때 행으로 바뀐다 */
  context(event: ContextTraceEvent): void;
  /**
   * 색인·기억 블록의 사실(턴 기록 싱크). 이 대화의 열린 턴에 붙이고, 턴이 끝날 때까지 그 턴의 모든 단계에 재료로 싣는다.
   * 열린 턴이 없거나 계측이 꺼진 턴이면 버린다
   */
  turnRecord(event: TurnBlockEvent): void;
  /** 대화를 지운다. 이 대화의 열린 턴 상태를 버린다. 대기 중인 쓰기는 호출자가 먼저 비운다 */
  forget(threadId: string): void;
}

/**
 * 테스트 실행 대화의 구성을 `tr_thread`에서 읽는다(§4.6 규칙 37). 범위가 `test`이고 기준 프로필이 있을 때만 싣는다.
 * 고정 초안 기록이 깨졌으면 초안 없이 싣고 기록한다. 초안의 판 식별자는 내용 해시에서 정한다(§4.8.1 3)
 */
function testRunOf(store: MeasureStore, threadId: string, logger: Logger): TurnTestRunMark {
  const found = store.getThread(threadId);
  if (!found.ok) return null;
  const row = found.value;
  if (row === undefined || row.scopeKind !== "test" || row.testBaseProfile === null) return null;
  const drafts = decodeTestRunDrafts(row.draftJson);
  if (!drafts.ok) logger.warn("measure.test_run_drafts_unreadable", { threadId });
  return {
    runGroupId: row.runGroupId,
    baseProfileId: row.testBaseProfile,
    drafts: (drafts.ok ? drafts.value : []).map((draft) => ({
      plugin: draft.plugin,
      draftId: draft.draftId,
      versionId: draftVersionIdOf(draft),
    })),
  };
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
  /** 설치별 소금(`tr_meta`). 호출 해시를 HMAC할 때 처음 한 번 읽고, 성공한 값만 쥔다 */
  let salt: string | undefined;
  /** 대화별 앞 모델 호출의 사용량(캐시 판정의 앞 호출, §4.5 규칙 30). 단계가 끝날 때 갈아 끼운다 */
  const priorUsage = new Map<
    string,
    CacheUsage & { readonly model: string; readonly endedAt: number }
  >();
  /** 압축 사건이 있었던 대화. 다음 단계 끝에서 한 번 읽고 지운다 */
  const compactedThreads = new Set<string>();
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

  function installSaltOf(): string | undefined {
    if (salt !== undefined) return salt;
    const read = deps.store.installSalt();
    if (!read.ok) {
      deps.logger.warn("measure.salt_read_failed", { reason: read.error.kind });
      return undefined;
    }
    salt = read.value;
    return salt;
  }

  /** 턴의 기록 수준. 계측이 켜졌으면 `full`, 꺼졌어도 테스트 실행 대화이고 항상 켜기가 참이면 `full`이다(§4.1 규칙 3, 4) */
  function levelOf(threadId: string): RecordLevel {
    if (deps.enabled()) return "full";
    if (deps.testRunsAlwaysOn() && scopeOf(deps.store, threadId, deps.logger) === "test") {
      return "full";
    }
    return "log_only";
  }

  /** 쓰인 행을 알린다. 리스너 실패는 버스가 기록하므로 여기서는 쓰기를 건드리지 않는다 */
  function publish(event: TurnRecordEvent): void {
    deps.events?.emit(event);
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
    // 초안 덧씌우기의 표지는 `overlay[].draftId`다. 그 턴의 범위를 `overlay_draft`로 바꾼다(§4.6 규칙 31)
    if (parsed.value.overlay.some((item) => item.draftId !== undefined)) draft.draftOverlay = true;
    const current = draft.profileRevChanges.at(-1)?.rev ?? draft.profile.rev;
    if (profileRev === current) return;
    draft.profileRevChanges.push({
      stepIndex: stepAfterBoundary(draft.lastStepIndex),
      rev: profileRev,
    });
  }

  /**
   * 하위 대화를 기억한다. `agent.spawned`는 자식의 첫 턴보다 먼저 커밋된다. 부모 턴에서 만든 것이면 그 턴의 자식 목록에도 넣는다(`flags.subagents`)
   */
  function rememberChild(record: DurableEventEnvelope): void {
    const parsed = parse(AgentSpawnedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    addBounded(childThreads, parsed.value.childThreadId);
    if (record.turnId !== null) {
      drafts.get(record.turnId)?.spawnedChildren.add(parsed.value.childThreadId);
    }
  }

  /** 이 대화에서 지금 열려 있는 턴(있으면 하나) */
  function openDraftOf(threadId: string): TurnDraft | undefined {
    for (const draft of drafts.values()) if (draft.threadId === threadId) return draft;
    return undefined;
  }

  /** 한도 소비량의 증분(§4.4 규칙 23). 엔진의 `charge`(ext-host `lease.ts`)가 더하는 세 칸이다 */
  interface FrameCharge {
    readonly turns: number;
    readonly spawns: number;
    readonly tokens: number;
  }

  /**
   * 열린 프레임 가운데 `leaseIds`에 든 것을 바꾼다. 대화의 열린 스택과, 이 대화의 열린 턴이 든 복사본을 함께 바꾼다.
   * 턴이 닫힐 때 복사본을 쓰므로, 여러 턴에 걸친 프레임의 값은 턴 사이에도 이어서 쌓인다
   */
  function patchFrames(
    threadId: string,
    leaseIds: ReadonlySet<string>,
    change: (frame: FrameMark) => FrameMark,
  ): void {
    const stack = openFrames.get(threadId);
    if (stack !== undefined) {
      openFrames.set(
        threadId,
        stack.map((frame) =>
          frame.leaseId !== null && leaseIds.has(frame.leaseId) ? change(frame) : frame,
        ),
      );
    }
    for (const draft of drafts.values()) {
      if (draft.threadId !== threadId) continue;
      draft.frames.forEach((frame, index) => {
        if (frame.leaseId !== null && leaseIds.has(frame.leaseId)) {
          draft.frames[index] = change(frame);
        }
      });
    }
  }

  /**
   * 맨 위 프레임부터 `leaseId`까지(`leaseId`가 없으면 맨 위 전부)에 증분을 더한다. 엔진은 맨 위 임대와 그 아래 프레임에 더하므로
   * 아래 프레임의 소비량에는 위 프레임의 소비도 든다(`charge`). 열린 프레임이 없으면 아무것도 하지 않는다
   */
  function chargeFrames(threadId: string, leaseId: string | null, charge: FrameCharge): void {
    if (charge.turns === 0 && charge.spawns === 0 && charge.tokens === 0) return;
    const stack = openFrames.get(threadId) ?? [];
    const at =
      leaseId === null ? stack.length - 1 : stack.findIndex((frame) => frame.leaseId === leaseId);
    if (at < 0) return;
    const covered = new Set<string>();
    for (const frame of stack.slice(0, at + 1)) {
      if (frame.leaseId !== null) covered.add(frame.leaseId);
    }
    patchFrames(threadId, covered, (frame) => ({
      ...frame,
      used: {
        turns: frame.used.turns + charge.turns,
        spawns: frame.used.spawns + charge.spawns,
        tokens: frame.used.tokens + charge.tokens,
      },
    }));
  }

  /**
   * 사용자 메시지 한 건(`input.queued`, 출처 사용자). 맨 위 임대의 받은 편지함으로 가므로 맨 위 프레임이 받은 것으로 센다.
   * 임대가 받은 메시지는 사건이 없어 이 길로 세지 않는다(§11 미결)
   */
  function queuedUserMessage(record: DurableEventEnvelope): void {
    const parsed = parse(InputQueuedPayloadSchema, record.payload);
    if (!parsed.ok || parsed.value.source.type !== "user" || parsed.value.item.kind !== "user") {
      return;
    }
    const top = openFrames.get(record.threadId)?.at(-1);
    if (top === undefined || top.leaseId === null) return;
    patchFrames(record.threadId, new Set([top.leaseId]), (frame) => ({
      ...frame,
      userMessages: frame.userMessages + 1,
    }));
  }

  /** 주도 함수가 낸 하위 대화(`agent.spawned`의 owner가 drive). 엔진은 그 임대와 아래 프레임에 spawns를 더한다 */
  function spawnCharge(record: DurableEventEnvelope): void {
    const parsed = parse(AgentSpawnedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    const owner = parsed.value.owner;
    if (owner.kind !== "drive") return;
    chargeFrames(record.threadId, owner.leaseId, { turns: 0, spawns: 1, tokens: 0 });
  }

  /**
   * 프레임 사건을 따른다(drive-isolation.md 2.6, 턴 기록 §4.9 규칙 23). `lease.acquired`는 프레임을 쌓고, `lease.released`는 내린다.
   * 깊이는 코어를 0으로 센다(`lease.acquired.depth`는 코어 위 첫 프레임이 0이라 1을 더한다).
   * 한도 소비량과 사용자 메시지 수는 이 사건으로 세지 않고 `chargeFrames`·`queuedUserMessage`가 센다.
   * `lowerResumedWith`는 실리는 사건이 없어 null이다
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

  /** 턴 행 하나를 쓴다. 범위는 쓰는 때마다 대화의 표지에서 다시 읽는다. 쓴 행을 돌려준다(알림의 `complete`가 이것을 따른다) */
  function writeTurnRow(
    store: MeasureStore,
    draft: TurnDraft,
    state: TurnState,
    phase: "open" | "closed",
  ): TrTurnRow {
    draft.scope = scopeOf(store, draft.threadId, deps.logger);
    if (draft.scope === "live" && draft.draftOverlay) draft.scope = "overlay_draft";
    draft.testRun = draft.scope === "test" ? testRunOf(store, draft.threadId, deps.logger) : null;
    const row = turnRowOf(draft, state);
    const written = store.upsertTurn(row);
    if (!written.ok) {
      deps.logger.warn("measure.turn_write_failed", { reason: written.error.kind, phase });
    }
    return row;
  }

  function turnStarted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(TurnStartedPayloadSchema, record.payload);
    const origin = parsed.ok && parsed.value.origin !== undefined ? parsed.value.origin : "user";
    // 같은 턴을 두 번 열지 않는다(방어)
    if (drafts.has(turnId)) return;
    // 주도 함수가 연 턴은 한도의 턴 수를 올린다. 이 턴의 복사본은 올린 값을 싣도록 복사하기 전에 센다
    if (origin === "drive") chargeFrames(record.threadId, null, { turns: 1, spawns: 0, tokens: 0 });
    const draft = newDraft({
      threadId: record.threadId,
      turnId,
      startedAt: record.recordedAt,
      startedEventId: record.id,
      origin,
      level: levelOf(record.threadId),
      maxBytes: deps.maxTurnBytes(),
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
      level: levelOf(record.threadId),
      maxBytes: deps.maxTurnBytes(),
      profile: profileAtStart(record.threadId),
    });
    remember(draft);
    return draft;
  }

  function stepCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(StepCompletedPayloadSchema, record.payload);
    // 압축은 이 단계 앞에 있었는지만 본다. 계측이 꺼진 턴도 다음 단계를 위해 비운다
    const compacted = compactedThreads.delete(record.threadId);
    if (!parsed.ok) return;
    const draft = draftOf(record, turnId);
    const { stepIndex, composition, contextWarnings } = parsed.value;
    // 프로필 경계가 가리키는 다음 단계를 정한다. 계측이 꺼진 턴도 턴 행의 프로필 변화에 필요하다
    draft.lastStepIndex = stepIndex;
    // 계측이 꺼진 턴은 단계 행을 쓰지 않는다(규칙 3: 턴 행만)
    if (draft.level !== "full") return;
    const stepId = record.stepId ?? `step:${String(stepIndex)}`;
    // 단계 끝의 훅(`boundary.step.after`, `boundary.settle.before`)은 이 커밋 전에 실행되어 이미 버퍼에 있다
    const entries = deps.trace?.turn(record.threadId, turnId)?.entries ?? [];
    const flats = flatHooksOf(entries);
    // 이 단계의 실행은 모두 본 것으로 친다(쓰거나 상한으로 버린 것). 아직 끝나지 않은 실행은 턴을 닫을 때 늦은 행이 된다
    for (const flat of flats) {
      if (flat.entry.step === stepIndex) draft.seenHooks.add(hookKeyOf(flat));
    }
    const hooks = hooksOfStep(
      flats,
      stepIndex,
      MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
      draft.approvals,
    );
    draft.hookRows += hooks.rows.length;
    draft.elidedHooks += hooks.elided;
    const hookRuns = hooks.rows.map((row) => row.run);
    // 도구 호출 줄은 단계의 CallRecord와 tr_call 행이 된다. 각 호출에는 그 호출 id로 묶인 훅 행을 붙인다(§4.3)
    const toolEvents = draft.toolCalls.get(stepId) ?? [];
    draft.toolCalls.delete(stepId);
    const sealed = toolEvents.length === 0 ? undefined : installSaltOf();
    const pairs =
      sealed === undefined
        ? []
        : toolEvents.map((event) => ({
            event,
            record: callRecordOf(event, {
              salt: sealed,
              turnStartedAt: draft.startedAt,
              hooks: hookRuns.filter((run) => run.toolCallId === event.toolCallId),
            }),
            // 원본 토큰은 이 줄에서 가려 저장하고, 행과 기록에는 가린 값만 간다
            maskedArgTokens: maskedArgTokensOf(sealed, event.argTokens),
          }));
    const base = { threadId: draft.threadId, turnId: draft.turnId, stepIndex };
    const usage = draft.calls.get(stepId) ?? [];

    // 조립 재료·광고와 스킬 읽기(측정 싱크가 준 것). 싱크가 없었던 단계는 자리 값이다
    const context = draft.contexts.get(stepId);
    draft.contexts.delete(stepId);
    const reads = draft.skillReads.get(stepId) ?? [];
    draft.skillReads.delete(stepId);
    const calledNames = toolEvents.flatMap((event) =>
      event.caller === "plugin" ? [] : [event.tool],
    );
    const noted = noteToolRows({
      tools: draft.tools,
      advertised: context?.advertised,
      calledNames,
    });
    draft.elidedTools += noted.elided;
    const materialPlan = materialPlanOf({
      materials: [...(context?.materials ?? []), ...blockMaterialsOf(draft.blocks)],
      budget: MAX_MATERIAL_ROWS_PER_TURN - draft.materialCount,
      seen: draft.materialKeys,
    });
    for (const material of materialPlan.fresh) draft.materialKeys.add(materialKeyOf(material));
    draft.materialCount += materialPlan.kept.length;
    draft.elidedMaterials += materialPlan.elided;
    const advertised =
      context === undefined ? undefined : advertisedRecordOf(context.advertised, noted.stepTools);
    const freshSkills: TrSkillRow[] = [];
    for (const read of reads) {
      const call = toolEvents.find((event) => event.toolCallId === read.toolCallId);
      // 실행되지 않은 호출은 읽은 것이 아니다
      if (call === undefined || call.verdict !== "allowed") continue;
      const name = nameOf(read.name);
      if (draft.skills.has(name)) continue;
      if (draft.skills.size >= MAX_SKILL_ROWS_PER_TURN) {
        draft.elidedSkills += 1;
        continue;
      }
      const skill = {
        name,
        plugin: nameOf(call.plugin ?? "none"),
        stepIndex,
        tokens: call.result?.tokens ?? 0,
      };
      draft.skills.set(name, skill);
      freshSkills.push({
        threadId: draft.threadId,
        turnId: draft.turnId,
        skill: skill.name,
        plugin: skill.plugin,
        listed: false,
        read: true,
        via: "model",
        stepIndex,
        tokens: skill.tokens,
      });
    }

    // 캐시 원인(§4.5 규칙 30). 앞 모델 호출과 이 단계의 사용량, 구조 경고, 압축 사건으로 정한다
    const first = usage[0];
    const current =
      first === undefined
        ? undefined
        : {
            model: first.modelId,
            startedAt: first.startedAt ?? first.recordedAt,
            cacheRead: usage.reduce((sum, call) => sum + call.usage.cacheRead, 0),
            cacheWrite: usage.reduce((sum, call) => sum + call.usage.cacheWrite, 0),
          };
    const cache = cacheBreakOf({
      warnings: contextWarnings ?? [],
      current,
      prior: priorUsage.get(draft.threadId),
      compacted,
      pluginOfTool: (name) => draft.tools.get(nameOf(name))?.plugin,
    });
    if (current !== undefined) {
      priorUsage.set(draft.threadId, {
        model: current.model,
        endedAt: Math.max(...usage.map((call) => call.recordedAt)),
        cacheRead: current.cacheRead,
        cacheWrite: current.cacheWrite,
      });
    }

    const step = stepRecordOf({
      stepIndex,
      stepId,
      turnStartedAt: draft.startedAt,
      calls: draft.calls.get(stepId) ?? [],
      toolCalls: pairs.map((pair) => pair.record),
      composition: composition ?? null,
      // 턴 수준 훅은 `turnHooks`에만 든다. 단계 0에서도 단계 기록에는 넣지 않는다(두 번 세지 않게)
      hooks: hookRuns.filter((run) => !isTurnLevelHook(run)),
      materials: materialPlan.kept,
      ...(advertised === undefined ? {} : { advertised }),
      cache,
    });
    draft.steps.push(step);
    const toolRows: TrToolUseRow[] = [];
    for (const name of noted.touched) {
      const row = draft.tools.get(name);
      if (row !== undefined) toolRows.push(trToolUseRowOf(row, draft));
    }
    const batch: TrStepBatch = {
      step: stepRowOf({
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepIndex,
        calls: step.modelCalls,
        ...(advertised === undefined
          ? {}
          : {
              context: {
                advertised,
                materialsFp:
                  step.materials.length === 0 ? null : materialsFingerprintOf(step.materials),
              },
            }),
      }),
      calls: pairs.map((pair) => trCallRowOf(pair.event, pair.record, base, pair.maskedArgTokens)),
      hooks: hooks.rows.map((row) => trHookRowOf(row, base)),
      materials: materialPlan.fresh.map((material) => trMaterialRowOf(material, base)),
      tooluse: toolRows,
      skills: freshSkills,
      // 가벼운 길의 줄은 턴을 닫을 때 쓴다(`turnCompleted`). 단계 묶음에는 싣지 않는다
      plugincalls: [],
      cache: cache === null ? [] : trCacheRowsOf(cache, base),
    };
    deps.queue((store) => {
      const written = store.writeStep(batch);
      if (written.ok) {
        // 쓴 단계만 알린다. 단계 행 다음에 그 행의 훅과 호출 행을 같은 단계 번호로 싣는다
        publish({
          kind: "rows",
          threadId: draft.threadId,
          turnId: draft.turnId,
          stepIndex,
          rows: [
            { kind: "step", stepIndex, step },
            ...hookRuns.map((hook): DeltaRow => ({ kind: "hook", stepIndex, hook })),
            ...step.calls.map((call): DeltaRow => ({ kind: "call", stepIndex, call })),
          ],
          final: false,
        });
        return;
      }
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
    const flats = flatHooksOf(deps.trace?.turn(record.threadId, turnId)?.entries ?? []);
    // 턴 수준 훅(턴 경계와 조립 앞의 첫 훅, 턴 전 훅)은 `record_json`의 `turnHooks`에만 든다. 단계 기록에는 없다.
    // 행은 단계 0을 쓸 때 이미 썼으므로 상한을 더 쓰지 않는다(§3.2)
    const turnHooks = full
      ? hooksOfStep(flats, 0, Number.POSITIVE_INFINITY, draft.approvals)
          .rows.map((row) => row.run)
          .filter(isTurnLevelHook)
      : [];
    // 아직 행으로 쓰지 않은 훅 실행은 늦은 행이다(§7 분리 실행). 실행이 시작된 단계에 한 번만 쓰고, 상한은 턴 훅 다음이다
    const late = full
      ? lateHooksOf(flats, {
          seen: draft.seenHooks,
          approvals: draft.approvals,
          room: MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
        })
      : { rows: [], elided: 0 };
    draft.hookRows += late.rows.length;
    draft.elidedHooks += late.elided;
    // 늦은 행은 그 단계의 기록에도 더한다(`record_json`의 steps.hooks). 단계 기록이 없으면 행으로만 남는다
    for (let at = 0; at < draft.steps.length; at += 1) {
      const step = draft.steps[at];
      if (step === undefined) continue;
      const extra = late.rows
        .filter((row) => row.stepIndex === step.stepIndex)
        .map((row) => row.run);
      if (extra.length > 0) draft.steps[at] = { ...step, hooks: [...step.hooks, ...extra] };
    }
    const lateBatch = late.rows.map((row) =>
      trHookRowOf(
        { run: row.run, seqGlobal: row.seqGlobal },
        { threadId: draft.threadId, turnId: draft.turnId, stepIndex: row.stepIndex },
      ),
    );
    const endedAt = record.recordedAt;
    const frameRows = (full ? draft.frames : []).flatMap((frame) => {
      const row = trFrameRowOf({ threadId: draft.threadId, turnId: draft.turnId }, frame);
      return row === null ? [] : [row];
    });
    // 가벼운 길의 줄은 들어온 순서대로 `seq`를 받는다. 계측이 꺼진 턴은 줄을 모으지 않았다
    const pluginCallRows = (full ? draft.pluginCalls : []).map((line, seq) =>
      trPluginCallRowOf(line, { threadId: draft.threadId, turnId: draft.turnId }, seq),
    );
    deps.queue((store) => {
      // 늦은 행을 먼저 쓴다. 쓰기가 실패하면 턴은 불완전하다
      if (lateBatch.length > 0) {
        const written = store.writeHooks(lateBatch);
        if (!written.ok) {
          draft.writeFailures += 1;
          deps.logger.warn("measure.hook_write_failed", {
            reason: written.error.kind,
            turnId,
          });
        }
      }
      if (frameRows.length > 0) {
        const written = store.writeFrames(frameRows);
        if (!written.ok) {
          draft.writeFailures += 1;
          deps.logger.warn("measure.frame_write_failed", { reason: written.error.kind });
        }
      }
      if (pluginCallRows.length > 0) {
        const written = store.writePluginCalls(pluginCallRows);
        if (!written.ok) {
          draft.writeFailures += 1;
          deps.logger.warn("measure.plugincall_write_failed", {
            reason: written.error.kind,
            turnId,
          });
        }
      }
      // 단계 쓰기가 하나라도 실패했으면 턴은 불완전하다. 계측이 꺼진 턴도 단계 기록이 없으므로 불완전하다
      const complete = full && draft.writeFailures === 0;
      const written = writeTurnRow(
        store,
        draft,
        { status, endedAt, complete, turnHooks },
        "closed",
      );
      // 턴 행은 쓰기가 실패해도 알린다(구독이 끝을 기다리지 않게 한다). 늦은 훅 행은 턴 행 앞에 온다
      publish({
        kind: "rows",
        threadId: draft.threadId,
        turnId,
        stepIndex: null,
        rows: [
          ...late.rows.map((row): DeltaRow => ({
            kind: "hook",
            stepIndex: row.stepIndex,
            hook: row.run,
          })),
          { kind: "turn", status, complete: written.complete },
        ],
        final: true,
      });
    });
  }

  return {
    event(record) {
      if (record.kind === "thread.compacted") compactedThreads.add(record.threadId);
      if (record.kind === "profile.applied") profileApplied(record);
      else if (record.kind === "thread.started" || record.kind === "thread.updated") {
        rememberStored(record);
      } else if (record.kind === "agent.spawned") {
        rememberChild(record);
        spawnCharge(record);
      } else if (record.kind === "lease.acquired" || record.kind === "lease.released") {
        frameEvent(record);
      } else if (record.kind === "input.queued") queuedUserMessage(record);
      const turnId = record.turnId;
      if (turnId === null) return;
      if (record.kind === "turn.started") turnStarted(record, turnId);
      else if (record.kind === "step.completed") stepCompleted(record, turnId);
      else if (record.kind === "turn.completed") turnCompleted(record, turnId);
    },
    usage(call) {
      // 한도 토큰은 엔진이 맨 위 프레임과 그 아래 프레임에 더하는 총 토큰이다(`chargeTokens`, `tokensOf`)
      chargeFrames(call.threadId, null, { turns: 0, spawns: 0, tokens: call.usage.totalTokens });
      if (call.turnId === null || call.stepId === null) return;
      const draft = drafts.get(call.turnId);
      if (draft === undefined || draft.level !== "full") return;
      const calls = draft.calls.get(call.stepId) ?? [];
      calls.push(call);
      draft.calls.set(call.stepId, calls);
    },
    call(event) {
      if (event.turnId === null || event.stepId === null) return;
      const draft = drafts.get(event.turnId);
      if (draft === undefined || draft.level !== "full" || draft.threadId !== event.threadId) {
        return;
      }
      if (draft.callRows >= MAX_CALL_ROWS_PER_TURN) {
        draft.elidedCalls += 1;
        return;
      }
      draft.callRows += 1;
      // 승인 해결은 훅 행의 물음 답을 채울 때 쓴다(턴을 닫을 때 늦은 행에도 맞도록 턴 단위로 쥔다)
      if (event.approval !== null) draft.approvals.set(event.toolCallId, event.approval);
      const bucket = draft.toolCalls.get(event.stepId) ?? [];
      bucket.push(event);
      draft.toolCalls.set(event.stepId, bucket);
    },
    pluginCall(event) {
      const draft = openDraftOf(event.threadId);
      if (draft === undefined || draft.level !== "full") return;
      if (draft.pluginCalls.length >= MAX_PLUGIN_CALL_ROWS_PER_TURN) return;
      const sealed = installSaltOf();
      if (sealed === undefined) return;
      const line = pluginCallLineOf(event, sealed);
      // 저장 모양에 맞지 않는 줄은 넣지 않는다. 그러지 않으면 이 턴의 기록 전체를 읽을 수 없게 된다
      if (!parse(PluginCallLineSchema, line).ok) return;
      draft.pluginCalls.push(line);
    },
    context(event) {
      const draft = drafts.get(event.turnId);
      if (draft === undefined || draft.level !== "full" || draft.threadId !== event.threadId) {
        return;
      }
      if (event.kind === "step_context") {
        draft.contexts.set(event.stepId, event);
        return;
      }
      const reads = draft.skillReads.get(event.stepId) ?? [];
      reads.push({ toolCallId: event.toolCallId, name: event.name });
      draft.skillReads.set(event.stepId, reads);
    },
    turnRecord(event) {
      const draft = openDraftOf(event.threadId);
      if (draft === undefined || draft.level !== "full") return;
      draft.blocks = withBlockFact(draft.blocks, event);
    },
    forget(threadId) {
      for (const [turnId, draft] of drafts) {
        if (draft.threadId === threadId) drafts.delete(turnId);
      }
      priorUsage.delete(threadId);
      compactedThreads.delete(threadId);
      storedProfiles.delete(threadId);
      appliedProfiles.delete(threadId);
      childThreads.delete(threadId);
      openFrames.delete(threadId);
    },
  };
}
