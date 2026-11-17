import { parse, type Logger } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type { ToolCallTraceEvent, TraceReadPort } from "@fresnel/contracts/extensions";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import {
  SCOPE_KINDS,
  type RecordLevel,
  type ScopeKind,
  type TurnStatus,
} from "@fresnel/contracts/wire";
import type { MeasureStore } from "./store.ts";
import type { TrStepBatch } from "./turn-tables.ts";
import {
  callRecordOf,
  flatHooksOf,
  hooksOfStep,
  MAX_CALL_ROWS_PER_TURN,
  MAX_HOOK_ROWS_PER_TURN,
  newDraft,
  stepRecordOf,
  stepRowOf,
  trCallRowOf,
  trHookRowOf,
  turnRowOf,
  type TurnDraft,
  type TurnState,
} from "./turn-rows.ts";

// 턴 기록의 쓰는 쪽(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.1, §4.6). 커밋된 사건을 보고 턴 하나의 상태를 메모리에 모은다.
// 쓰기는 모두 `queue`로 넘겨 마이크로태스크의 묶음에서 실행한다(TX-09): 모델 호출 경로는 SQLite 쓰기를 기다리지 않는다.
// 턴은 `turn.started`에 `open` 행으로 열고, 단계가 끝날 때 그 단계의 행을 쓰고, `turn.completed`에 최종 상태로 닫는다.
// 계측이 꺼진 턴은 턴 행만 쓴다(`log_only`, 규칙 3). 켜진 턴은 단계 행과 훅 행을 쓴다(`full`).

/** 아직 끝나지 않은 턴의 상태를 쥐는 상한. 넘으면 가장 먼저 연 턴부터 버린다(그 턴의 행은 `open`으로 남고 다음 열기 때 `lost`가 된다) */
const MAX_OPEN_TURNS = 64;

type StoreOp = (store: MeasureStore) => void;

export interface TurnWriterDeps {
  readonly store: MeasureStore;
  readonly trace: Pick<TraceReadPort, "turn"> | undefined;
  /** 계측 켬 여부(`x.operations.trace.enabled`의 현재 값). 턴을 처음 볼 때 한 번 읽는다(규칙 6) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
  /** 쓰기를 묶음에 넣는다. 마이크로태스크에서 넣은 순서대로 실행된다 */
  readonly queue: (op: StoreOp) => void;
}

export interface TurnWriter {
  /** 커밋된 사건 한 건. 턴 시작, 단계 끝, 턴 끝만 본다 */
  event(record: DurableEventEnvelope): void;
  /** 모델 호출 한 번(사용량 합산기). 단계의 모델 호출을 모은다 */
  usage(call: UsageRecord): void;
  /** 도구 호출 하나가 닫힌 줄(추적 싱크). 계측이 켜진 턴의 단계에 모은다. 반환값은 호출 경로로 돌아가지 않는다 */
  call(event: ToolCallTraceEvent): void;
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
  /** 설치별 소금(`tr_meta`). 호출 해시를 HMAC할 때 처음 한 번 읽고, 성공한 값만 쥔다 */
  let salt: string | undefined;

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

  function levelNow(): RecordLevel {
    return deps.enabled() ? "full" : "log_only";
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
    });
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
    });
    remember(draft);
    return draft;
  }

  function stepCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(StepCompletedPayloadSchema, record.payload);
    if (!parsed.ok) return;
    const draft = draftOf(record, turnId);
    // 계측이 꺼진 턴은 단계 행을 쓰지 않는다(규칙 3: 턴 행만)
    if (draft.level !== "full") return;
    const { stepIndex, composition } = parsed.value;
    const stepId = record.stepId ?? `step:${String(stepIndex)}`;
    // 단계 끝의 훅(`boundary.step.after`, `boundary.settle.before`)은 이 커밋 전에 실행되어 이미 버퍼에 있다
    const entries = deps.trace?.turn(record.threadId, turnId)?.entries ?? [];
    const hooks = hooksOfStep(
      flatHooksOf(entries),
      stepIndex,
      MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
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
          }));
    const step = stepRecordOf({
      stepIndex,
      stepId,
      turnStartedAt: draft.startedAt,
      calls: draft.calls.get(stepId) ?? [],
      toolCalls: pairs.map((pair) => pair.record),
      composition: composition ?? null,
      hooks: hookRuns,
    });
    draft.steps.push(step);
    const batch: TrStepBatch = {
      step: stepRowOf({
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepIndex,
        calls: step.modelCalls,
      }),
      calls: pairs.map((pair) =>
        trCallRowOf(pair.event, pair.record, {
          threadId: draft.threadId,
          turnId: draft.turnId,
          stepIndex,
        }),
      ),
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
        ).rows.map((row) => row.run)
      : [];
    const endedAt = record.recordedAt;
    deps.queue((store) => {
      // 단계 쓰기가 하나라도 실패했으면 턴은 불완전하다. 계측이 꺼진 턴도 단계 기록이 없으므로 불완전하다
      const complete = full && draft.writeFailures === 0;
      writeTurnRow(store, draft, { status, endedAt, complete, turnHooks }, "closed");
    });
  }

  return {
    event(record) {
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
      const bucket = draft.toolCalls.get(event.stepId) ?? [];
      bucket.push(event);
      draft.toolCalls.set(event.stepId, bucket);
    },
    forget(threadId) {
      for (const [turnId, draft] of drafts) {
        if (draft.threadId === threadId) drafts.delete(turnId);
      }
    },
  };
}
