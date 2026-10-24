import { err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  PlanVersionSchema,
  WorkTaskSchema,
  type PlanVersion,
  type WorkTask,
} from "@xeon/contracts/capabilities";
import type { ReadFailure, SqlRow } from "@xeon/contracts/records";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { WorkReader } from "../ports/session.ts";

// 투영 테이블 읽기(L2.work.spec §3.8). 읽은 행이 스키마와 다르면 손상이므로 row_invalid로 알린다(TY-24).

function rowInvalid(where: string): ReadFailure {
  return { kind: "row_invalid", where };
}

function textOrNull(cell: SqlRow[string] | undefined): string | null {
  return typeof cell === "string" ? cell : null;
}

export function readTasks(reader: WorkReader, threadId: ThreadId): Result<WorkTask[], ReadFailure> {
  const read = reader.read((tx) => ({
    tasks: tx.all(
      `SELECT task_id, content, active_form, status, owner FROM cap_work_tasks
       WHERE session_id = ? ORDER BY ord`,
      [threadId],
    ),
    edges: tx.all(
      `SELECT task_id, blocked_by FROM cap_work_task_edges WHERE session_id = ? ORDER BY rowid`,
      [threadId],
    ),
  }));
  if (!read.ok) return err(read.error);
  const blockedBy = new Map<string, string[]>();
  for (const edge of read.value.edges) {
    const task = edge["task_id"];
    const blocker = edge["blocked_by"];
    if (typeof task !== "string" || typeof blocker !== "string") {
      return err(rowInvalid("cap_work_task_edges"));
    }
    const list = blockedBy.get(task) ?? [];
    list.push(blocker);
    blockedBy.set(task, list);
  }
  const tasks: WorkTask[] = [];
  for (const row of read.value.tasks) {
    const id = row["task_id"];
    const parsed = parse(WorkTaskSchema, {
      id,
      content: row["content"],
      activeForm: textOrNull(row["active_form"]),
      status: row["status"],
      owner: textOrNull(row["owner"]),
      blockedBy: typeof id === "string" ? (blockedBy.get(id) ?? []) : [],
    });
    if (!parsed.ok) return err(rowInvalid("cap_work_tasks"));
    tasks.push(parsed.value);
  }
  return ok(tasks);
}

export interface WorkMeta {
  readonly turnsCompleted: number;
  readonly lastTaskChangeTurn: number;
}

export function readMeta(reader: WorkReader, threadId: ThreadId): Result<WorkMeta, ReadFailure> {
  const read = reader.read((tx) =>
    tx.get(
      `SELECT turns_completed, last_task_change_turn FROM cap_work_meta WHERE session_id = ?`,
      [threadId],
    ),
  );
  if (!read.ok) return err(read.error);
  const row = read.value;
  if (row === undefined) return ok({ turnsCompleted: 0, lastTaskChangeTurn: 0 });
  const turns = Number(row["turns_completed"]);
  const changed = Number(row["last_task_change_turn"]);
  if (!Number.isInteger(turns) || !Number.isInteger(changed))
    return err(rowInvalid("cap_work_meta"));
  return ok({ turnsCompleted: turns, lastTaskChangeTurn: changed });
}

// ── 계획(cap_work_plans)과 권한 모드 추적(cap_work_meta) ────────────────────

/** 투영에서 읽은 계획 한 판. PlanVersion에 제출·결정 시점(seq)을 더했다 */
export interface PlanRow extends PlanVersion {
  readonly submittedSeq: number;
  readonly decidedSeq: number | null;
}

const PLAN_COLUMNS = `plan_id, version, title, body, status, artifact, approval_id, feedback, submitted_seq, decided_seq`;

function planRowOf(row: SqlRow): Result<PlanRow, ReadFailure> {
  const artifactText = textOrNull(row["artifact"]);
  const artifactJson = artifactText === null ? ok(null) : parseJson(artifactText);
  if (!artifactJson.ok) return err(rowInvalid("cap_work_plans.artifact"));
  const version = parse(PlanVersionSchema, {
    planId: row["plan_id"],
    version: row["version"] === undefined ? undefined : Number(row["version"]),
    title: row["title"],
    body: row["body"],
    status: row["status"],
    artifact: artifactJson.value,
    approvalId: textOrNull(row["approval_id"]),
    feedback: textOrNull(row["feedback"]),
  });
  if (!version.ok) return err(rowInvalid("cap_work_plans"));
  const decided = row["decided_seq"];
  return ok({
    ...version.value,
    submittedSeq: Number(row["submitted_seq"]),
    decidedSeq: decided === null || decided === undefined ? null : Number(decided),
  });
}

function planRowsOf(rows: readonly SqlRow[]): Result<PlanRow[], ReadFailure> {
  const plans: PlanRow[] = [];
  for (const row of rows) {
    const plan = planRowOf(row);
    if (!plan.ok) return plan;
    plans.push(plan.value);
  }
  return ok(plans);
}

/** 스레드의 계획 모든 판, 제출 순서대로 */
export function readPlans(reader: WorkReader, threadId: ThreadId): Result<PlanRow[], ReadFailure> {
  const read = reader.read((tx) =>
    tx.all(
      `SELECT ${PLAN_COLUMNS} FROM cap_work_plans WHERE session_id = ? ORDER BY submitted_seq`,
      [threadId],
    ),
  );
  return read.ok ? planRowsOf(read.value) : err(read.error);
}

/** 승인 id로 계획 판과 그 판이 속한 스레드를 찾는다. 해당 판이 없으면 undefined */
export function readPlanByApproval(
  reader: WorkReader,
  approvalId: string,
): Result<{ readonly threadId: string; readonly plan: PlanRow } | undefined, ReadFailure> {
  const read = reader.read((tx) =>
    tx.get(`SELECT session_id, ${PLAN_COLUMNS} FROM cap_work_plans WHERE approval_id = ?`, [
      approvalId,
    ]),
  );
  if (!read.ok) return err(read.error);
  if (read.value === undefined) return ok(undefined);
  const plan = planRowOf(read.value);
  const threadId = read.value["session_id"];
  if (!plan.ok) return plan;
  if (typeof threadId !== "string") return err(rowInvalid("cap_work_plans.session_id"));
  return ok({ threadId, plan: plan.value });
}

/** 권한 모드 추적. 세션 범위 모드 변경 이벤트에서 만든 값이다(spec §4.2.5) */
export interface ModeMeta {
  /** 세션 범위에서 마지막으로 정한 모드. 한 번도 없으면 null */
  readonly mode: string | null;
  readonly modeBeforePlan: string | null;
  /** 지금 계획 모드이면 들어온 시점의 seq, 아니면 null */
  readonly planEnteredSeq: number | null;
}

export function readModeMeta(
  reader: WorkReader,
  threadId: ThreadId,
): Result<ModeMeta, ReadFailure> {
  const read = reader.read((tx) =>
    tx.get(
      `SELECT mode, mode_before_plan, plan_entered_seq FROM cap_work_meta WHERE session_id = ?`,
      [threadId],
    ),
  );
  if (!read.ok) return err(read.error);
  const row = read.value;
  if (row === undefined) return ok({ mode: null, modeBeforePlan: null, planEnteredSeq: null });
  const entered = row["plan_entered_seq"];
  return ok({
    mode: textOrNull(row["mode"]),
    modeBeforePlan: textOrNull(row["mode_before_plan"]),
    planEnteredSeq: entered === null || entered === undefined ? null : Number(entered),
  });
}
