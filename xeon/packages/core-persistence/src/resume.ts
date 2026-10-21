// 열기, 열 때 복구, 재개(L1.persistence.spec §3.6, §3.7, §4.8). 이 파일은 아무것도 실행하지 않는다:
// recover는 합성 결과를 커밋하고 남은 일을 ResumePlan으로 돌려줄 뿐이다(adr.0006 §3.1).
import { Bug, err, ok, parse, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  EffectExecSchema,
  EffectIntentSchema,
  ItemRecordedPayloadSchema,
  type AutoResumeVerdict,
  type CommitPlan,
  type DurableEventEnvelope,
  type EffectExec,
  type EffectIntent,
  type EffectRerun,
  type LeaseService,
  type LeaseToken,
  type OpenError,
  type OpenReport,
  type PendingToolCall,
  type Projector,
  type RecoverDeps,
  type ResumeError,
  type ResumePlan,
  type SessionShutdownReason,
  type SqlTx,
  type StepCheckpoint,
  type StoreDb,
  type StoreError,
} from "@xeon/contracts/records";
import { readCheckpoint } from "./checkpoint.ts";
import type { PersistenceSettings } from "./deps.ts";
import { envelopeAtSeq, parseEnvelope } from "./events.ts";
import { sessionResource, toEffectId } from "./ids.ts";
import type { OpenSessions } from "./ownership.ts";
import { PERSISTENCE_PRODUCER, type ProducerRegistry } from "./producers.ts";
import { ensureProjectors } from "./projector/rebuild.ts";
import { readOrThrow } from "./read.ts";
import {
  closeInsteadOfRerun,
  decideOpenEffect,
  synthesisRequest,
  type SynthesisDeps,
} from "./recovery.ts";
import { columnInt, columnNullableInt, columnString } from "./rows.ts";
import type { KindCatalog } from "./upcast.ts";
import { readOnlyReasonFor } from "./upcast.ts";
import {
  markerOf,
  readOpenTurn,
  readPendingApprovals,
  readQueuedInputs,
  readThread,
  type ThreadRow,
} from "./views.ts";
import type { SessionWriter } from "./writer.ts";

export interface ResumeDeps {
  readonly db: StoreDb;
  readonly leases: LeaseService;
  readonly catalog: KindCatalog;
  readonly producers: ProducerRegistry;
  readonly sessions: OpenSessions;
  readonly writer: SessionWriter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly settings: () => PersistenceSettings;
  readonly projectors: () => readonly Projector[];
  /** 서비스를 시작하며 다시 만든 투영기 이름. 처음 여는 thread의 OpenReport.rebuilt에 한 번 실린다 */
  readonly takeStartupRebuilt: () => readonly string[];
  readonly logger: Logger | undefined;
}

export interface Resumer {
  openForWrite(threadId: ThreadId, token: LeaseToken): Result<OpenReport, OpenError>;
  openForRead(threadId: ThreadId): Result<OpenReport, OpenError>;
  recover(threadId: ThreadId, recoverDeps: RecoverDeps): Result<ResumePlan, StoreError>;
  beginResume(
    threadId: ThreadId,
    mode: "manual" | "auto",
  ): Result<{ readonly attempt: number }, ResumeError>;
  release(threadId: ThreadId, reason: SessionShutdownReason): Promise<void>;
}

interface OpenEffectRow {
  readonly intent: EffectIntent;
  readonly intentEvent: DurableEventEnvelope;
  readonly lastExec: EffectExec | null;
  readonly execCount: number;
}

interface RecoverSnapshot {
  readonly thread: ThreadRow | undefined;
  readonly checkpoint: StepCheckpoint | null;
  readonly abortRequested: boolean;
  readonly openTurnId: TurnId | null;
  readonly effects: readonly OpenEffectRow[];
  readonly pendingToolCalls: readonly PendingToolCall[];
  readonly pendingApprovals: readonly EventId[];
}

/** 열린 효과: effect.intent가 있고 effect.result가 없는 효과. 인자와 마지막 exec는 이벤트에서 읽는다 */
function readOpenEffectRows(tx: SqlTx, threadId: string): readonly OpenEffectRow[] {
  const rows = tx.all(
    `SELECT intent_seq, last_exec_seq, exec_count FROM p_effects
     WHERE thread_id = ? AND result_seq IS NULL ORDER BY intent_seq`,
    [threadId],
  );
  return rows.map((row): OpenEffectRow => {
    const intentSeq = columnInt(row, "intent_seq");
    const intentEvent = envelopeAtSeq(tx, intentSeq);
    if (intentEvent === undefined) throw new Bug(`store.row_invalid: no event at seq ${intentSeq}`);
    const intent = parse(EffectIntentSchema, intentEvent.payload);
    if (!intent.ok)
      throw new Bug("store.row_invalid: effect.intent payload", { cause: intent.error });
    const execSeq = columnNullableInt(row, "last_exec_seq");
    let lastExec: EffectExec | null = null;
    if (execSeq !== null) {
      const execEvent = envelopeAtSeq(tx, execSeq);
      const exec = parse(EffectExecSchema, execEvent?.payload);
      if (!exec.ok) throw new Bug("store.row_invalid: effect.exec payload", { cause: exec.error });
      lastExec = exec.value;
    }
    return {
      intent: intent.value,
      intentEvent,
      lastExec,
      execCount: columnInt(row, "exec_count"),
    };
  });
}

/**
 * 의도가 없는 도구 호출(§4.7.4): 마지막 step.completed 뒤의 assistant item에 toolCall이 있고 그 호출의 effect.intent도,
 * 거부된 호출의 toolResult item도 없다. 승인 대기 표시는 마지막 체크포인트에서 가져온다
 */
function readPendingToolCalls(
  tx: SqlTx,
  threadId: string,
  turnId: string,
  checkpoint: StepCheckpoint | null,
): readonly PendingToolCall[] {
  const stepRow = tx.get(
    "SELECT MAX(seq) AS seq FROM events WHERE thread_id = ? AND turn_id = ? AND kind = 'step.completed'",
    [threadId, turnId],
  );
  const floor = (stepRow === undefined ? null : columnNullableInt(stepRow, "seq")) ?? 0;
  const rows = tx.all(
    `SELECT envelope FROM events
     WHERE thread_id = ? AND turn_id = ? AND kind = 'item.recorded' AND seq > ? ORDER BY seq`,
    [threadId, turnId, floor],
  );
  const calls: string[] = [];
  const answered = new Set<string>();
  for (const row of rows) {
    const event = parseEnvelope(columnString(row, "envelope"));
    const recorded = parse(ItemRecordedPayloadSchema, event.payload);
    if (!recorded.ok)
      throw new Bug("store.row_invalid: item.recorded payload", { cause: recorded.error });
    const { item } = recorded.value;
    if (item.kind === "assistant") {
      for (const block of item.message.content) {
        if (block.type === "toolCall") calls.push(block.id);
      }
    } else if (item.kind === "toolResult") {
      answered.add(item.message.toolCallId);
    }
  }
  const waitingOf = new Map(
    (checkpoint?.pendingToolCalls ?? []).map((call) => [call.toolCallId, call.waiting] as const),
  );
  const pending: PendingToolCall[] = [];
  for (const toolCallId of calls) {
    if (answered.has(toolCallId)) continue;
    const effect = tx.get(
      "SELECT effect_id FROM p_effects WHERE thread_id = ? AND tool_call_id = ?",
      [threadId, toolCallId],
    );
    if (effect !== undefined) continue;
    pending.push({ toolCallId, effectId: null, waiting: waitingOf.get(toolCallId) ?? null });
  }
  return pending;
}

function autoResumeVerdict(args: {
  readonly marker: ResumePlan["marker"];
  readonly aborted: boolean;
  readonly settings: PersistenceSettings;
  readonly hostMode: RecoverDeps["hostMode"];
}): AutoResumeVerdict {
  const { marker, aborted, settings, hostMode } = args;
  if (marker === null) return { allowed: false, reason: "no_marker" };
  if (aborted) return { allowed: false, reason: "abort_requested" };
  if (!settings.autoResume) return { allowed: false, reason: "setting_off" };
  if (hostMode !== "service") return { allowed: false, reason: "not_service_mode" };
  if (marker.resumeAttempts >= settings.maxResumeAttempts) {
    return { allowed: false, reason: "attempts_exhausted" };
  }
  return { allowed: true };
}

/** thread의 서로 다른 (kind, version) 쌍. events_thread_kind 색인을 훑는다 */
function threadPairs(
  tx: SqlTx,
  threadId: string,
): readonly { readonly kind: string; readonly version: number }[] {
  return tx
    .all("SELECT DISTINCT kind, version FROM events WHERE thread_id = ?", [threadId])
    .map((row) => ({ kind: columnString(row, "kind"), version: columnInt(row, "version") }));
}

export function createResumer(deps: ResumeDeps): Resumer {
  const { db, leases, catalog, producers, sessions, writer, clock, ids } = deps;
  const synthesisDeps: SynthesisDeps = { clock, ids, producers };

  const ownerInfo = (threadId: ThreadId): OpenReport["owner"] => {
    const info = leases.inspect(sessionResource(threadId));
    return info.ok ? info.value : null;
  };

  /** recover와 beginResume이 쓰는 쓰기 소유 확인. 관찰·읽기 전용이면 커밋할 수 없다 */
  const requireOwner = (threadId: ThreadId): StoreError | null => {
    const state = sessions.stateOf(threadId);
    if (state === undefined) return { kind: "ownership_lost", threadId };
    if (state.role === "observer") return { kind: "read_only", reason: "observer" };
    if (state.readOnly !== null) return { kind: "read_only", reason: state.readOnly };
    return null;
  };

  return {
    openForWrite(threadId, token): Result<OpenReport, OpenError> {
      if (token.resource !== sessionResource(threadId)) {
        return err({ kind: "guard_mismatch", threadId });
      }
      const checked = db.read((tx) => ({
        thread: readThread(tx, threadId),
        holds: leases.holds(tx, token),
        pairs: threadPairs(tx, threadId),
      }));
      if (!checked.ok) return err({ kind: "busy" });
      if (checked.value.thread === undefined) return err({ kind: "thread_not_found", threadId });
      if (!checked.value.holds) return err({ kind: "guard_mismatch", threadId });
      const readOnly = readOnlyReasonFor(checked.value.pairs, catalog);
      let rebuilt: readonly string[] = [];
      if (readOnly === null) {
        const ensured = ensureProjectors(db, deps.projectors(), catalog);
        if (!ensured.ok) return err({ kind: "busy" });
        rebuilt = [...deps.takeStartupRebuilt(), ...ensured.value];
      }
      const prior = sessions.stateOf(threadId);
      sessions.set(threadId, {
        role: "owner",
        token,
        readOnly,
        selfAcquired: prior?.role === "owner" ? prior.selfAcquired : false,
        keepAlive: prior?.role === "owner" ? prior.keepAlive : null,
      });
      const thread = readOrThrow(db, (tx) => readThread(tx, threadId));
      if (thread === undefined) return err({ kind: "thread_not_found", threadId });
      return ok({
        threadId,
        role: "owner",
        headSeq: thread.headSeq,
        marker: markerOf(thread),
        readOnly,
        rebuilt,
        owner: ownerInfo(threadId),
      });
    },

    openForRead(threadId): Result<OpenReport, OpenError> {
      const checked = db.read((tx) => ({
        thread: readThread(tx, threadId),
        pairs: threadPairs(tx, threadId),
      }));
      if (!checked.ok) return err({ kind: "busy" });
      const { thread, pairs } = checked.value;
      if (thread === undefined) return err({ kind: "thread_not_found", threadId });
      // 관찰 열기는 버전 검사만 한다. 재생성은 쓰기 소유자가 한다
      const versionReason = readOnlyReasonFor(pairs, catalog);
      const state = sessions.stateOf(threadId);
      const owned = state?.role === "owner";
      if (!owned) sessions.set(threadId, { role: "observer" });
      return ok({
        threadId,
        role: owned ? "owner" : "observer",
        headSeq: thread.headSeq,
        marker: markerOf(thread),
        readOnly: owned ? (state.readOnly ?? versionReason) : "observer",
        // 관찰 열기는 재생성을 하지 않는다(쓰기 소유자가 한다)
        rebuilt: [],
        owner: ownerInfo(threadId),
      });
    },

    recover(threadId, recoverDeps): Result<ResumePlan, StoreError> {
      const denied = requireOwner(threadId);
      if (denied !== null) return err(denied);
      const snapshot = db.read((tx): RecoverSnapshot => {
        const thread = readThread(tx, threadId);
        const checkpoint = readCheckpoint(tx, threadId);
        const openTurn = readOpenTurn(tx, threadId);
        const openTurnId = thread?.openTurnId ?? null;
        return {
          thread,
          checkpoint,
          abortRequested: openTurn?.abortRequested ?? false,
          openTurnId,
          effects: readOpenEffectRows(tx, threadId),
          pendingToolCalls:
            openTurnId === null ? [] : readPendingToolCalls(tx, threadId, openTurnId, checkpoint),
          pendingApprovals:
            openTurnId === null
              ? []
              : readPendingApprovals(tx, threadId).map((approval) => approval.approvalId),
        };
      });
      if (!snapshot.ok) return err({ kind: "busy" });
      const state = snapshot.value;
      if (state.thread === undefined) return err({ kind: "thread_not_found", threadId });
      // 5단계: 취소 의도(내구 turn.abort_requested 또는 소유 사슬 취소)가 6단계의 재실행 판정보다 앞선다
      const aborted =
        state.openTurnId !== null &&
        (state.abortRequested || recoverDeps.cancelledByOwner(threadId, state.openTurnId));

      const synthesized: ResumePlan["synthesized"][number][] = [];
      const reruns: EffectRerun[] = [];
      for (const open of state.effects) {
        const base = decideOpenEffect({
          intent: open.intent,
          lastExec: open.lastExec,
          result: null,
          currentReplay: recoverDeps.toolReplay(open.intent.toolName),
          execCount: open.execCount,
        });
        const decision = aborted ? closeInsteadOfRerun(base, open.lastExec !== null) : base;
        if (decision.action === "none") continue;
        if (decision.action === "rerun") {
          // effect.exec 커밋 키의 끝 토막. 첫 실행 키(…:exec)와 겹치지 않게 1부터 센다
          reruns.push({ intent: decision.intent, attempt: Math.max(1, open.execCount) });
          continue;
        }
        const committed = writer.commit(
          synthesisRequest(synthesisDeps, {
            threadId,
            intentEvent: open.intentEvent,
            intent: open.intent,
            code: decision.code,
            result: decision.result,
            content: decision.content,
          }),
        );
        if (!committed.ok) return committed;
        const result = committed.value;
        if (result.status === "key_reused") {
          throw new Bug(`store.schema_invalid: synthesis key reused for ${open.intent.toolCallId}`);
        }
        // already_settled로 거부되면 다른 곳이 먼저 닫은 것이다. 합성 목록에 싣지 않는다
        if (result.status === "committed") {
          synthesized.push({
            effectId: toEffectId(open.intent.effectId),
            toolCallId: open.intent.toolCallId,
            code: decision.code,
          });
        }
      }

      const marker = markerOf(state.thread);
      const queued = readOrThrow(db, (tx) => readQueuedInputs(tx, threadId));
      const checkpointOfOpenTurn =
        state.checkpoint !== null && state.checkpoint.turnId === state.openTurnId
          ? state.checkpoint
          : null;
      return ok({
        threadId,
        checkpoint: state.checkpoint,
        marker,
        synthesized,
        reruns,
        pendingToolCalls: state.pendingToolCalls,
        // 자식 thread 복원은 M2(p_agents)에서 채운다
        pendingApprovals: state.pendingApprovals,
        queuedInputs: queued,
        openChildren: [],
        abortRequestedTurn: aborted ? state.openTurnId : null,
        next: state.openTurnId === null ? "idle" : (checkpointOfOpenTurn?.next ?? "request"),
        autoResume: autoResumeVerdict({
          marker,
          aborted,
          settings: deps.settings(),
          hostMode: recoverDeps.hostMode,
        }),
      });
    },

    beginResume(threadId, mode): Result<{ readonly attempt: number }, ResumeError> {
      const denied = requireOwner(threadId);
      if (denied !== null) return err(denied);
      const snapshot = db.read((tx) => ({
        thread: readThread(tx, threadId),
        checkpoint: readCheckpoint(tx, threadId),
      }));
      if (!snapshot.ok) return err({ kind: "busy" });
      const { thread, checkpoint } = snapshot.value;
      if (thread === undefined) return err({ kind: "thread_not_found", threadId });
      const marker = markerOf(thread);
      if (marker === null) return err({ kind: "no_open_turn", threadId });
      const max = deps.settings().maxResumeAttempts;
      if (marker.resumeAttempts >= max) {
        return err({ kind: "attempts_exhausted", attempts: marker.resumeAttempts, max });
      }
      const attempt = marker.resumeAttempts + 1;
      const turnId = marker.turnId;
      const fromCheckpointId =
        checkpoint !== null && checkpoint.turnId === turnId ? checkpoint.checkpointId : null;
      const handle = producers.internal(PERSISTENCE_PRODUCER);
      const committed = writer.commit({
        threadId,
        requestId: `resume:${turnId}:${attempt}`,
        fingerprintSource: { turnId, attempt, mode },
        build(view): CommitPlan {
          const turn = view.turn(turnId);
          if (turn === undefined || (turn.status !== "running" && turn.status !== "waiting")) {
            return { kind: "reject", code: "no_open_turn", detail: turnId };
          }
          return {
            kind: "append",
            drafts: [
              handle.draft({
                id: ids.next("evt"),
                kind: "thread.resumed",
                threadId,
                turnId,
                stepId: null,
                causationId: null,
                correlationId: turnId,
                payload: { turnId, attempt, mode, fromCheckpointId },
              }),
            ],
            checkpoint: null,
          };
        },
      });
      if (!committed.ok) return committed;
      const result = committed.value;
      switch (result.status) {
        case "committed":
          return ok({ attempt });
        case "rejected":
          return err({ kind: "no_open_turn", threadId });
        case "key_reused":
          throw new Bug(`store.schema_invalid: resume key reused (${result.requestId})`);
        default:
          throw new Bug("store.schema_invalid: unknown commit status");
      }
    },

    release(threadId, _reason): Promise<void> {
      // session_shutdown 지점 발화는 PS-17(ExtHost 연결)에서 더한다. 여기서는 소유 상태만 놓는다
      const prior = sessions.forget(threadId);
      if (prior?.role === "owner") {
        prior.keepAlive?.[Symbol.dispose]();
        // 호스트가 준 토큰은 호스트가 반납한다. 이 서비스가 직접 얻은 임대(자식 thread)만 반납한다
        if (prior.selfAcquired) {
          const released = leases.release(prior.token);
          if (!released.ok) {
            deps.logger?.warn("session.release_failed", { reason: released.error.kind });
          }
        }
      }
      return Promise.resolve();
    },
  };
}
