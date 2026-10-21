import { Bug, parse } from "@xeon/contracts";
import {
  ReplayPolicySchema,
  ThreadStatusSchema,
  TurnStatusSchema,
  type ReplayPolicy,
  type ThreadId,
  type ThreadStatus,
  type TurnId,
  type TurnStatus,
} from "@xeon/contracts/conversation";
import {
  EffectStatusSchema,
  type EffectStatus,
  type ApprovalView,
  type EffectView,
  type InputView,
  type RecoveryMarker,
  type SqlRow,
  type SqlTx,
  type TurnView,
} from "@xeon/contracts/records";
import { toEffectId, toEventId, toThreadId, toTurnId } from "./ids.ts";
import {
  columnBool,
  columnInt,
  columnNullableInt,
  columnNullableString,
  columnString,
} from "./rows.ts";

// 투영 테이블(p_*)을 읽는 질의 묶음. TxView(커밋 트랜잭션 안)와 ProjectionQuery(밖)가 같은 SQL을 쓴다.
// 이 패키지 밖에서 p_* 이름이 나오지 않게 하는 것이 목적이다(CM-02, TX-07).

function turnStatusOf(row: SqlRow): TurnStatus {
  const parsed = parse(TurnStatusSchema, columnString(row, "status"));
  if (!parsed.ok) throw new Bug("store.row_invalid: p_turns.status", { cause: parsed.error });
  return parsed.value;
}

function turnViewOf(row: SqlRow): TurnView {
  return {
    turnId: toTurnId(columnString(row, "turn_id")),
    status: turnStatusOf(row),
    abortRequested: columnNullableInt(row, "abort_requested_seq") !== null,
    stepCount: columnInt(row, "step_count"),
  };
}

const TURN_COLUMNS = "turn_id, status, abort_requested_seq, step_count";

export function readTurn(tx: SqlTx, turnId: string): TurnView | undefined {
  const row = tx.get(`SELECT ${TURN_COLUMNS} FROM p_turns WHERE turn_id = ?`, [turnId]);
  return row === undefined ? undefined : turnViewOf(row);
}

export function readTurnByRequest(
  tx: SqlTx,
  threadId: string,
  scopeId: string | null,
  requestId: string,
): TurnView | undefined {
  const row = tx.get(
    `SELECT ${TURN_COLUMNS} FROM p_turns
     WHERE thread_id = ? AND COALESCE(scope_id, '') = ? AND request_id = ?`,
    [threadId, scopeId ?? "", requestId],
  );
  return row === undefined ? undefined : turnViewOf(row);
}

export function readOpenTurn(tx: SqlTx, threadId: string): TurnView | undefined {
  const row = tx.get(
    `SELECT t.turn_id, t.status, t.abort_requested_seq, t.step_count
     FROM p_threads p JOIN p_turns t ON t.turn_id = p.open_turn_id WHERE p.thread_id = ?`,
    [threadId],
  );
  return row === undefined ? undefined : turnViewOf(row);
}

function replayOf(row: SqlRow): ReplayPolicy {
  const parsed = parse(ReplayPolicySchema, columnString(row, "replay"));
  if (!parsed.ok) throw new Bug("store.row_invalid: p_effects.replay", { cause: parsed.error });
  return parsed.value;
}

function effectStatusOf(value: string): EffectStatus {
  const parsed = parse(EffectStatusSchema, value);
  if (!parsed.ok)
    throw new Bug("store.row_invalid: p_effects.result_status", { cause: parsed.error });
  return parsed.value;
}

function effectViewOf(row: SqlRow): EffectView {
  const resultSeq = columnNullableInt(row, "result_seq");
  const status = columnNullableString(row, "result_status");
  return {
    effectId: toEffectId(columnString(row, "effect_id")),
    toolCallId: columnString(row, "tool_call_id"),
    toolName: columnString(row, "tool_name"),
    replay: replayOf(row),
    execCount: columnInt(row, "exec_count"),
    result:
      resultSeq === null || status === null
        ? null
        : { status: effectStatusOf(status), synthesized: columnBool(row, "synthesized") },
  };
}

const EFFECT_COLUMNS =
  "effect_id, tool_call_id, tool_name, replay, exec_count, result_seq, result_status, synthesized";

export function readEffect(tx: SqlTx, effectId: string): EffectView | undefined {
  const row = tx.get(`SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE effect_id = ?`, [effectId]);
  return row === undefined ? undefined : effectViewOf(row);
}

export function readEffectByCall(
  tx: SqlTx,
  threadId: string,
  toolCallId: string,
): EffectView | undefined {
  const row = tx.get(
    `SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE thread_id = ? AND tool_call_id = ?`,
    [threadId, toolCallId],
  );
  return row === undefined ? undefined : effectViewOf(row);
}

export function readOpenEffects(tx: SqlTx, threadId: string): readonly EffectView[] {
  return tx
    .all(
      `SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE thread_id = ? AND result_seq IS NULL ORDER BY intent_seq`,
      [threadId],
    )
    .map(effectViewOf);
}

function inputViewOf(row: SqlRow): InputView {
  const mode = columnString(row, "mode");
  const state = columnString(row, "state");
  if (mode !== "steer" && mode !== "followUp" && mode !== "next" && mode !== "aside") {
    throw new Bug(`store.row_invalid: p_inputs.mode ${mode}`);
  }
  if (state !== "queued" && state !== "placed" && state !== "withdrawn") {
    throw new Bug(`store.row_invalid: p_inputs.state ${state}`);
  }
  return {
    inputId: toEventId(columnString(row, "input_id")),
    seq: columnInt(row, "seq"),
    mode,
    state,
    sourceKey: columnString(row, "source_key"),
    requestId: columnString(row, "request_id"),
  };
}

const INPUT_COLUMNS = "input_id, seq, mode, state, source_key, request_id";

export function readInputByRequest(
  tx: SqlTx,
  threadId: string,
  sourceKey: string,
  requestId: string,
): InputView | undefined {
  const row = tx.get(
    `SELECT ${INPUT_COLUMNS} FROM p_inputs WHERE thread_id = ? AND source_key = ? AND request_id = ?`,
    [threadId, sourceKey, requestId],
  );
  return row === undefined ? undefined : inputViewOf(row);
}

export function readQueuedInputs(tx: SqlTx, threadId: string): readonly InputView[] {
  return tx
    .all(
      `SELECT ${INPUT_COLUMNS} FROM p_inputs WHERE thread_id = ? AND state = 'queued' ORDER BY seq`,
      [threadId],
    )
    .map(inputViewOf);
}

/** p_threads 행. 서비스 안에서만 쓰는 모양이다 */
export interface ThreadRow {
  readonly threadId: ThreadId;
  readonly title: string | null;
  readonly status: ThreadStatus;
  readonly workspace: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly headSeq: number;
  readonly leafEventId: string | null;
  readonly forkedFrom: { readonly threadId: ThreadId; readonly eventId: string } | null;
  readonly openTurnId: TurnId | null;
  readonly runningSince: number | null;
  readonly resumeAttempts: number;
}

export function readThread(tx: SqlTx, threadId: string): ThreadRow | undefined {
  const row = tx.get(
    `SELECT thread_id, title, status, workspace, created_at, updated_at, head_seq, leaf_event_id,
       forked_from_thread, forked_from_event, open_turn_id, running_since, resume_attempts
     FROM p_threads WHERE thread_id = ?`,
    [threadId],
  );
  if (row === undefined) return undefined;
  const status = parse(ThreadStatusSchema, columnString(row, "status"));
  if (!status.ok) throw new Bug("store.row_invalid: p_threads.status", { cause: status.error });
  const forkThread = columnNullableString(row, "forked_from_thread");
  const forkEvent = columnNullableString(row, "forked_from_event");
  const openTurn = columnNullableString(row, "open_turn_id");
  return {
    threadId: toThreadId(columnString(row, "thread_id")),
    title: columnNullableString(row, "title"),
    status: status.value,
    workspace: columnNullableString(row, "workspace"),
    createdAt: columnInt(row, "created_at"),
    updatedAt: columnInt(row, "updated_at"),
    headSeq: columnInt(row, "head_seq"),
    leafEventId: columnNullableString(row, "leaf_event_id"),
    forkedFrom:
      forkThread === null || forkEvent === null
        ? null
        : { threadId: toThreadId(forkThread), eventId: forkEvent },
    openTurnId: openTurn === null ? null : toTurnId(openTurn),
    runningSince: columnNullableInt(row, "running_since"),
    resumeAttempts: columnInt(row, "resume_attempts"),
  };
}

/** 복구 표식: 열린 turn의 시작 시각과 재개 시도 수. 열린 turn이 없으면 null(adr.0006 §3.6 5번) */
export function markerOf(thread: ThreadRow): RecoveryMarker | null {
  if (thread.openTurnId === null || thread.runningSince === null) return null;
  return {
    turnId: thread.openTurnId,
    runningSince: thread.runningSince,
    resumeAttempts: thread.resumeAttempts,
  };
}

function approvalViewOf(row: SqlRow): ApprovalView {
  return {
    approvalId: toEventId(columnString(row, "approval_id")),
    threadId: toThreadId(columnString(row, "thread_id")),
    toolCallId: columnNullableString(row, "tool_call_id"),
    resolved: columnNullableInt(row, "resolved_seq") !== null,
  };
}

const APPROVAL_COLUMNS = "approval_id, thread_id, tool_call_id, resolved_seq";

export function readApproval(tx: SqlTx, approvalId: string): ApprovalView | undefined {
  const row = tx.get(`SELECT ${APPROVAL_COLUMNS} FROM p_approvals WHERE approval_id = ?`, [
    approvalId,
  ]);
  return row === undefined ? undefined : approvalViewOf(row);
}

/** 해결되지 않은 승인 요청, 요청 순서 */
export function readPendingApprovals(tx: SqlTx, threadId: string): readonly ApprovalView[] {
  return tx
    .all(
      `SELECT ${APPROVAL_COLUMNS} FROM p_approvals
       WHERE thread_id = ? AND resolved_seq IS NULL ORDER BY requested_seq`,
      [threadId],
    )
    .map(approvalViewOf);
}
