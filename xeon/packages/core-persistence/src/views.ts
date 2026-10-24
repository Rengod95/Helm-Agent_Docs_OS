import { err, ok, type Result } from "@xeon/contracts";
import {
  ReplayPolicySchema,
  ThreadStatusSchema,
  TurnStatusSchema,
  type EventId,
  type ThreadId,
  type ThreadStatus,
  type TurnId,
} from "@xeon/contracts/conversation";
import {
  EffectStatusSchema,
  type AgentView,
  type ApprovalView,
  type EffectView,
  type InputView,
  type RecoveryMarker,
  type SqlRow,
  type SqlTx,
  type ThreadSummaryRow,
  type TurnView,
} from "@xeon/contracts/records";
import { columns, rowInvalid, type RowFault } from "./rows.ts";
import { AgentSettledStatusSchema } from "./agent-status.ts";

// 투영 테이블(p_*)을 읽는 질의 묶음. TxView(커밋 트랜잭션 안)와 ProjectionQuery(밖)가 같은 SQL을 쓴다.
// 이 패키지 밖에서 p_* 이름이 나오지 않게 하는 것이 목적이다(CM-02, TX-07).
// 행이 모양과 다르면 row_invalid 값으로 돌려준다(TY-24). 호출자가 읽기 API의 오류나 커밋 중단으로 올린다.

function turnViewOf(row: SqlRow): Result<TurnView, RowFault> {
  const c = columns(row, "p_turns");
  const turnId = c.id("trn", "turn_id");
  if (!turnId.ok) return turnId;
  const status = c.parsed(TurnStatusSchema, "status");
  if (!status.ok) return status;
  const abortSeq = c.nullableInt("abort_requested_seq");
  if (!abortSeq.ok) return abortSeq;
  const stepCount = c.int("step_count");
  if (!stepCount.ok) return stepCount;
  return ok({
    turnId: turnId.value,
    status: status.value,
    abortRequested: abortSeq.value !== null,
    stepCount: stepCount.value,
  });
}

const TURN_COLUMNS = "turn_id, status, abort_requested_seq, step_count";

export function readTurn(tx: SqlTx, turnId: string): Result<TurnView | undefined, RowFault> {
  const row = tx.get(`SELECT ${TURN_COLUMNS} FROM p_turns WHERE turn_id = ?`, [turnId]);
  return row === undefined ? ok(undefined) : turnViewOf(row);
}

export function readTurnByRequest(
  tx: SqlTx,
  threadId: string,
  scopeId: string | null,
  requestId: string,
): Result<TurnView | undefined, RowFault> {
  const row = tx.get(
    `SELECT ${TURN_COLUMNS} FROM p_turns
     WHERE thread_id = ? AND COALESCE(scope_id, '') = ? AND request_id = ?`,
    [threadId, scopeId ?? "", requestId],
  );
  return row === undefined ? ok(undefined) : turnViewOf(row);
}

export function readOpenTurn(tx: SqlTx, threadId: string): Result<TurnView | undefined, RowFault> {
  const row = tx.get(
    `SELECT t.turn_id, t.status, t.abort_requested_seq, t.step_count
     FROM p_threads p JOIN p_turns t ON t.turn_id = p.open_turn_id WHERE p.thread_id = ?`,
    [threadId],
  );
  return row === undefined ? ok(undefined) : turnViewOf(row);
}

function effectViewOf(row: SqlRow): Result<EffectView, RowFault> {
  const c = columns(row, "p_effects");
  const effectId = c.id("efx", "effect_id");
  if (!effectId.ok) return effectId;
  const toolCallId = c.string("tool_call_id");
  if (!toolCallId.ok) return toolCallId;
  const toolName = c.string("tool_name");
  if (!toolName.ok) return toolName;
  const replay = c.parsed(ReplayPolicySchema, "replay");
  if (!replay.ok) return replay;
  const execCount = c.int("exec_count");
  if (!execCount.ok) return execCount;
  const resultSeq = c.nullableInt("result_seq");
  if (!resultSeq.ok) return resultSeq;
  const resultStatus = c.nullableString("result_status");
  if (!resultStatus.ok) return resultStatus;
  let result: EffectView["result"] = null;
  if (resultSeq.value !== null && resultStatus.value !== null) {
    const status = c.parsed(EffectStatusSchema, "result_status");
    if (!status.ok) return status;
    const synthesized = c.bool("synthesized");
    if (!synthesized.ok) return synthesized;
    result = { status: status.value, synthesized: synthesized.value };
  }
  return ok({
    effectId: effectId.value,
    toolCallId: toolCallId.value,
    toolName: toolName.value,
    replay: replay.value,
    execCount: execCount.value,
    result,
  });
}

const EFFECT_COLUMNS =
  "effect_id, tool_call_id, tool_name, replay, exec_count, result_seq, result_status, synthesized";

export function readEffect(tx: SqlTx, effectId: string): Result<EffectView | undefined, RowFault> {
  const row = tx.get(`SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE effect_id = ?`, [effectId]);
  return row === undefined ? ok(undefined) : effectViewOf(row);
}

export function readEffectByCall(
  tx: SqlTx,
  threadId: string,
  toolCallId: string,
): Result<EffectView | undefined, RowFault> {
  const row = tx.get(
    `SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE thread_id = ? AND tool_call_id = ?`,
    [threadId, toolCallId],
  );
  return row === undefined ? ok(undefined) : effectViewOf(row);
}

/** 행마다 decode를 적용해 첫 실패에서 멈춘다 */
function decodeAll<T>(
  rows: readonly SqlRow[],
  decode: (row: SqlRow) => Result<T, RowFault>,
): Result<readonly T[], RowFault> {
  const out: T[] = [];
  for (const row of rows) {
    const item = decode(row);
    if (!item.ok) return item;
    out.push(item.value);
  }
  return ok(out);
}

export function readOpenEffects(
  tx: SqlTx,
  threadId: string,
): Result<readonly EffectView[], RowFault> {
  return decodeAll(
    tx.all(
      `SELECT ${EFFECT_COLUMNS} FROM p_effects WHERE thread_id = ? AND result_seq IS NULL ORDER BY intent_seq`,
      [threadId],
    ),
    effectViewOf,
  );
}

function inputViewOf(row: SqlRow): Result<InputView, RowFault> {
  const c = columns(row, "p_inputs");
  const mode = c.string("mode");
  if (!mode.ok) return mode;
  const state = c.string("state");
  if (!state.ok) return state;
  const { value: modeValue } = mode;
  const { value: stateValue } = state;
  if (
    modeValue !== "steer" &&
    modeValue !== "followUp" &&
    modeValue !== "next" &&
    modeValue !== "aside"
  ) {
    return err(rowInvalid("p_inputs.mode"));
  }
  if (stateValue !== "queued" && stateValue !== "placed" && stateValue !== "withdrawn") {
    return err(rowInvalid("p_inputs.state"));
  }
  const inputId = c.id("evt", "input_id");
  if (!inputId.ok) return inputId;
  const seq = c.int("seq");
  if (!seq.ok) return seq;
  const sourceKey = c.string("source_key");
  if (!sourceKey.ok) return sourceKey;
  const requestId = c.string("request_id");
  if (!requestId.ok) return requestId;
  return ok({
    inputId: inputId.value,
    seq: seq.value,
    mode: modeValue,
    state: stateValue,
    sourceKey: sourceKey.value,
    requestId: requestId.value,
  });
}

const INPUT_COLUMNS = "input_id, seq, mode, state, source_key, request_id";

export function readInputByRequest(
  tx: SqlTx,
  threadId: string,
  sourceKey: string,
  requestId: string,
): Result<InputView | undefined, RowFault> {
  const row = tx.get(
    `SELECT ${INPUT_COLUMNS} FROM p_inputs WHERE thread_id = ? AND source_key = ? AND request_id = ?`,
    [threadId, sourceKey, requestId],
  );
  return row === undefined ? ok(undefined) : inputViewOf(row);
}

export function readQueuedInputs(
  tx: SqlTx,
  threadId: string,
): Result<readonly InputView[], RowFault> {
  return decodeAll(
    tx.all(
      `SELECT ${INPUT_COLUMNS} FROM p_inputs WHERE thread_id = ? AND state = 'queued' ORDER BY seq`,
      [threadId],
    ),
    inputViewOf,
  );
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
  readonly leafEventId: EventId | null;
  readonly forkedFrom: { readonly threadId: ThreadId; readonly eventId: EventId } | null;
  readonly openTurnId: TurnId | null;
  readonly runningSince: number | null;
  readonly resumeAttempts: number;
}

export function readThread(tx: SqlTx, threadId: string): Result<ThreadRow | undefined, RowFault> {
  const row = tx.get(
    `SELECT thread_id, title, status, workspace, created_at, updated_at, head_seq, leaf_event_id,
       forked_from_thread, forked_from_event, open_turn_id, running_since, resume_attempts
     FROM p_threads WHERE thread_id = ?`,
    [threadId],
  );
  if (row === undefined) return ok(undefined);
  const c = columns(row, "p_threads");
  const id = c.id("thr", "thread_id");
  if (!id.ok) return id;
  const title = c.nullableString("title");
  if (!title.ok) return title;
  const status = c.parsed(ThreadStatusSchema, "status");
  if (!status.ok) return status;
  const workspace = c.nullableString("workspace");
  if (!workspace.ok) return workspace;
  const createdAt = c.int("created_at");
  if (!createdAt.ok) return createdAt;
  const updatedAt = c.int("updated_at");
  if (!updatedAt.ok) return updatedAt;
  const headSeq = c.int("head_seq");
  if (!headSeq.ok) return headSeq;
  const leaf = c.nullableId("evt", "leaf_event_id");
  if (!leaf.ok) return leaf;
  const forkThread = c.nullableId("thr", "forked_from_thread");
  if (!forkThread.ok) return forkThread;
  const forkEvent = c.nullableId("evt", "forked_from_event");
  if (!forkEvent.ok) return forkEvent;
  const openTurn = c.nullableId("trn", "open_turn_id");
  if (!openTurn.ok) return openTurn;
  const runningSince = c.nullableInt("running_since");
  if (!runningSince.ok) return runningSince;
  const resumeAttempts = c.int("resume_attempts");
  if (!resumeAttempts.ok) return resumeAttempts;
  return ok({
    threadId: id.value,
    title: title.value,
    status: status.value,
    workspace: workspace.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    headSeq: headSeq.value,
    leafEventId: leaf.value,
    forkedFrom:
      forkThread.value === null || forkEvent.value === null
        ? null
        : { threadId: forkThread.value, eventId: forkEvent.value },
    openTurnId: openTurn.value,
    runningSince: runningSince.value,
    resumeAttempts: resumeAttempts.value,
  });
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

function approvalViewOf(row: SqlRow): Result<ApprovalView, RowFault> {
  const c = columns(row, "p_approvals");
  const approvalId = c.id("evt", "approval_id");
  if (!approvalId.ok) return approvalId;
  const threadId = c.id("thr", "thread_id");
  if (!threadId.ok) return threadId;
  const toolCallId = c.nullableString("tool_call_id");
  if (!toolCallId.ok) return toolCallId;
  const resolvedSeq = c.nullableInt("resolved_seq");
  if (!resolvedSeq.ok) return resolvedSeq;
  return ok({
    approvalId: approvalId.value,
    threadId: threadId.value,
    toolCallId: toolCallId.value,
    resolved: resolvedSeq.value !== null,
  });
}

const APPROVAL_COLUMNS = "approval_id, thread_id, tool_call_id, resolved_seq";

export function readApproval(
  tx: SqlTx,
  approvalId: string,
): Result<ApprovalView | undefined, RowFault> {
  const row = tx.get(`SELECT ${APPROVAL_COLUMNS} FROM p_approvals WHERE approval_id = ?`, [
    approvalId,
  ]);
  return row === undefined ? ok(undefined) : approvalViewOf(row);
}

/** 해결되지 않은 승인 요청, 요청 순서 */
export function readPendingApprovals(
  tx: SqlTx,
  threadId: string,
): Result<readonly ApprovalView[], RowFault> {
  return decodeAll(
    tx.all(
      `SELECT ${APPROVAL_COLUMNS} FROM p_approvals
       WHERE thread_id = ? AND resolved_seq IS NULL ORDER BY requested_seq`,
      [threadId],
    ),
    approvalViewOf,
  );
}

/** thread.list·query.thread가 돌려주는 요약 행. 대기 입력 수와 해결되지 않은 승인 수를 같이 센다 */
export function readThreadSummary(
  tx: SqlTx,
  thread: ThreadRow,
): Result<ThreadSummaryRow, RowFault> {
  const queued = readQueuedInputs(tx, thread.threadId);
  if (!queued.ok) return queued;
  const approvals = readPendingApprovals(tx, thread.threadId);
  if (!approvals.ok) return approvals;
  return ok({
    threadId: thread.threadId,
    title: thread.title,
    status: thread.status,
    workspace: thread.workspace,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    headSeq: thread.headSeq,
    forkedFrom: thread.forkedFrom,
    marker: markerOf(thread),
    queuedInputs: queued.value.length,
    pendingApprovals: approvals.value.length,
  });
}

const AGENT_COLUMNS =
  "child_thread_id, thread_id, request_id, owner_turn_id, background, depth, settled_seq, settled_status, settled_event_id";

function agentViewOf(row: SqlRow): Result<AgentView, RowFault> {
  const c = columns(row, "p_agents");
  const childThreadId = c.id("thr", "child_thread_id");
  if (!childThreadId.ok) return childThreadId;
  const parentThreadId = c.id("thr", "thread_id");
  if (!parentThreadId.ok) return parentThreadId;
  const requestId = c.string("request_id");
  if (!requestId.ok) return requestId;
  const ownerTurnId = c.nullableId("trn", "owner_turn_id");
  if (!ownerTurnId.ok) return ownerTurnId;
  const background = c.bool("background");
  if (!background.ok) return background;
  const depth = c.int("depth");
  if (!depth.ok) return depth;
  const settledSeq = c.nullableInt("settled_seq");
  if (!settledSeq.ok) return settledSeq;
  let settled: AgentView["settled"] = null;
  if (settledSeq.value !== null) {
    const status = c.parsed(AgentSettledStatusSchema, "settled_status");
    if (!status.ok) return status;
    const eventId = c.id("evt", "settled_event_id");
    if (!eventId.ok) return eventId;
    settled = { status: status.value, eventId: eventId.value };
  }
  return ok({
    childThreadId: childThreadId.value,
    parentThreadId: parentThreadId.value,
    requestId: requestId.value,
    ownerTurnId: ownerTurnId.value,
    background: background.value,
    depth: depth.value,
    settled,
  });
}

/** 부모 대화의 agent.spawned 중 같은 자식 requestId (멱등 조회) */
export function readAgentByRequest(
  tx: SqlTx,
  parentThreadId: string,
  requestId: string,
): Result<AgentView | undefined, RowFault> {
  const row = tx.get(
    `SELECT ${AGENT_COLUMNS} FROM p_agents WHERE thread_id = ? AND request_id = ?`,
    [parentThreadId, requestId],
  );
  return row === undefined ? ok(undefined) : agentViewOf(row);
}

/** 부모의 자식 연결, 생성 순서. unsettledOnly면 정착하지 않은 것만 */
export function readChildAgents(
  tx: SqlTx,
  parentThreadId: string,
  unsettledOnly: boolean,
): Result<readonly AgentView[], RowFault> {
  return decodeAll(
    tx.all(
      `SELECT ${AGENT_COLUMNS} FROM p_agents
       WHERE thread_id = ? ${unsettledOnly ? "AND settled_seq IS NULL" : ""} ORDER BY spawned_seq`,
      [parentThreadId],
    ),
    agentViewOf,
  );
}

/** 열린 turn이 소유한, 정착하지 않은 자식(재개 계획의 openChildren) */
export function readOpenChildren(
  tx: SqlTx,
  parentThreadId: string,
  turnId: string,
): Result<readonly AgentView[], RowFault> {
  return decodeAll(
    tx.all(
      `SELECT ${AGENT_COLUMNS} FROM p_agents
       WHERE thread_id = ? AND owner_turn_id = ? AND settled_seq IS NULL ORDER BY spawned_seq`,
      [parentThreadId, turnId],
    ),
    agentViewOf,
  );
}
