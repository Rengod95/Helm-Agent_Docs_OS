import { Bug, parse, parseJson } from "@xeon/contracts";
import { GoalSchema, type Goal } from "@xeon/contracts/capabilities";
import type { TSchema, Static } from "typebox";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  SettingsChangedPayloadSchema,
  WorkGoalJudgedSchema,
  WorkGoalSetSchema,
  WorkGoalSettledSchema,
  WorkPlanSubmittedSchema,
  WorkPlanWithdrawnSchema,
  WorkReportBuiltSchema,
  WorkTaskChangedSchema,
  WorkTaskCreatedSchema,
  WorkTaskLinkSchema,
  type DurableEventEnvelope,
  type EventKind,
  type ProjectionTx,
  type Projector,
} from "@xeon/contracts/records";
import { outcomeOf } from "../plans/decision.ts";
import { PERMISSION_MODE_KEY, PLAN_REF_PATTERN } from "../plans/refs.ts";
import {
  WORK_PROJECTOR_DDL,
  WORK_PROJECTOR_NAME,
  WORK_PROJECTOR_TABLES,
  WORK_PROJECTOR_VERSION,
} from "./ddl.ts";

// L2.work.spec §3.8. 이벤트의 순수 함수다(EV-06): 시계, 난수, 파일을 쓰지 않고 소유 테이블만 갱신한다.
// 이벤트 payload는 커밋 때 카탈로그 스키마로 검증됐으므로 모양이 다르면 코드 결함이다.

function ordOf(taskId: string): number {
  return Number(taskId.slice(1));
}

function payloadOf<S extends TSchema>(schema: S, event: DurableEventEnvelope): Static<S> {
  const parsed = parse(schema, event.payload);
  return parsed.ok
    ? parsed.value
    : failProjection(`${event.kind} payload does not match its catalog schema`, parsed.error);
}

function failProjection(message: string, cause: unknown): never {
  throw new Bug(`store.projection_failed: cap.work ${message}`, { cause });
}

/** 작업 이벤트가 일어났음을 알린다: 방치 알림의 기준 턴을 지금 완료 턴 수로 맞춘다 */
function touchMeta(tx: ProjectionTx, sessionId: string): void {
  tx.run(
    `INSERT INTO cap_work_meta (session_id, turns_completed, last_task_change_turn) VALUES (?, 0, 0)
     ON CONFLICT(session_id) DO UPDATE SET last_task_change_turn = turns_completed`,
    [sessionId],
  );
}

function applyCreated(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { task } = payloadOf(WorkTaskCreatedSchema, event);
  const sessionId = event.threadId;
  tx.run(
    `INSERT INTO cap_work_tasks
       (session_id, task_id, ord, content, active_form, status, owner, created_seq, updated_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      task.id,
      ordOf(task.id),
      task.content,
      task.activeForm,
      task.status,
      task.owner,
      event.seq,
      event.seq,
    ],
  );
  for (const blocker of task.blockedBy) {
    tx.run(`INSERT INTO cap_work_edges (session_id, task_id, blocked_by) VALUES (?, ?, ?)`, [
      sessionId,
      task.id,
      blocker,
    ]);
  }
  touchMeta(tx, sessionId);
}

function applyChanged(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { taskId, set } = payloadOf(WorkTaskChangedSchema, event);
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  if (set.content !== undefined) {
    assignments.push("content = ?");
    params.push(set.content);
  }
  if (set.activeForm !== undefined) {
    assignments.push("active_form = ?");
    params.push(set.activeForm);
  }
  if (set.status !== undefined) {
    assignments.push("status = ?");
    params.push(set.status);
  }
  if (set.owner !== undefined) {
    assignments.push("owner = ?");
    params.push(set.owner);
  }
  assignments.push("updated_seq = ?");
  params.push(event.seq, event.threadId, taskId);
  tx.run(
    `UPDATE cap_work_tasks SET ${assignments.join(", ")} WHERE session_id = ? AND task_id = ?`,
    params,
  );
  touchMeta(tx, event.threadId);
}

function applyLinked(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { taskId, blockedBy } = payloadOf(WorkTaskLinkSchema, event);
  for (const blocker of blockedBy) {
    tx.run(
      `INSERT OR IGNORE INTO cap_work_edges (session_id, task_id, blocked_by) VALUES (?, ?, ?)`,
      [event.threadId, taskId, blocker],
    );
  }
  tx.run(`UPDATE cap_work_tasks SET updated_seq = ? WHERE session_id = ? AND task_id = ?`, [
    event.seq,
    event.threadId,
    taskId,
  ]);
  touchMeta(tx, event.threadId);
}

function applyUnlinked(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { taskId, blockedBy } = payloadOf(WorkTaskLinkSchema, event);
  for (const blocker of blockedBy) {
    tx.run(`DELETE FROM cap_work_edges WHERE session_id = ? AND task_id = ? AND blocked_by = ?`, [
      event.threadId,
      taskId,
      blocker,
    ]);
  }
  tx.run(`UPDATE cap_work_tasks SET updated_seq = ? WHERE session_id = ? AND task_id = ?`, [
    event.seq,
    event.threadId,
    taskId,
  ]);
  touchMeta(tx, event.threadId);
}

function applyTurnCompleted(tx: ProjectionTx, event: DurableEventEnvelope): void {
  tx.run(
    `INSERT INTO cap_work_meta (session_id, turns_completed, last_task_change_turn) VALUES (?, 1, 0)
     ON CONFLICT(session_id) DO UPDATE SET turns_completed = turns_completed + 1`,
    [event.threadId],
  );
}

const WORK_PROJECTOR_KINDS: readonly EventKind[] = [
  "work.task_created",
  "work.task_changed",
  "work.task_linked",
  "work.task_unlinked",
  "work.plan_submitted",
  "work.plan_withdrawn",
  "work.goal_set",
  "work.goal_judged",
  "work.goal_settled",
  "work.report_built",
  "approval.requested",
  "approval.resolved",
  "settings.changed",
  "turn.completed",
];

function applyPlanSubmitted(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const plan = payloadOf(WorkPlanSubmittedSchema, event);
  tx.run(
    `INSERT INTO cap_work_plans
       (session_id, plan_id, version, title, body, status, artifact, approval_id, feedback, submitted_seq, decided_seq)
     VALUES (?, ?, ?, ?, ?, 'submitted', ?, NULL, NULL, ?, NULL)`,
    [
      event.threadId,
      plan.planId,
      plan.version,
      plan.title,
      plan.body,
      plan.artifact === null ? null : JSON.stringify(plan.artifact),
      event.seq,
    ],
  );
  // 새 판을 낼 수 있는 이전 판은 결정이 났거나 철회된 것이다. 아직 대기 중인 판만 superseded로 바꾼다
  if (plan.supersedes !== null) {
    tx.run(
      `UPDATE cap_work_plans SET status = 'superseded', decided_seq = ?
       WHERE session_id = ? AND plan_id = ? AND version = ? AND status = 'submitted'`,
      [event.seq, event.threadId, plan.planId, plan.supersedes],
    );
  }
}

function applyPlanWithdrawn(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const plan = payloadOf(WorkPlanWithdrawnSchema, event);
  tx.run(
    `UPDATE cap_work_plans SET status = 'withdrawn', decided_seq = ?
     WHERE session_id = ? AND plan_id = ? AND version = ? AND status = 'submitted'`,
    [event.seq, event.threadId, plan.planId, plan.version],
  );
}

/** kind plan의 승인 요청이 어느 계획 판의 것인지 planRef로 찾아 승인 id를 기록한다 */
function applyApprovalRequested(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const request = payloadOf(ApprovalRequestedPayloadSchema, event);
  if (request.body.kind !== "plan") return;
  const ref = PLAN_REF_PATTERN.exec(request.body.plan.planRef ?? "");
  if (ref === null) return;
  tx.run(
    `UPDATE cap_work_plans SET approval_id = ?
     WHERE session_id = ? AND plan_id = ? AND version = ? AND approval_id IS NULL`,
    [event.id, request.origin.threadId, ref[1] ?? "", Number(ref[2])],
  );
}

function applyApprovalResolved(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const resolved = payloadOf(ApprovalResolvedPayloadSchema, event);
  const outcome = outcomeOf(resolved.decision, resolved.answer, resolved.resolvedBy);
  if (outcome.kind === "withdrawn") {
    tx.run(
      `UPDATE cap_work_plans SET status = 'withdrawn', decided_seq = ?
       WHERE approval_id = ? AND status = 'submitted'`,
      [event.seq, resolved.approvalId],
    );
    return;
  }
  tx.run(
    `UPDATE cap_work_plans SET status = ?, feedback = ?, decided_seq = ?
     WHERE approval_id = ? AND status = 'submitted'`,
    [outcome.decision, outcome.feedback, event.seq, resolved.approvalId],
  );
}

/**
 * 권한 모드 변경(세션 범위)을 따라가며 계획 모드에 들어가기 직전 모드와 들어온 시점을 기록한다(spec §4.2.5).
 * 세션 범위 값이 한 번도 없었으면 이전 모드는 기본값 default다
 */
function applySettingsChanged(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const change = payloadOf(SettingsChangedPayloadSchema, event);
  if (change.key !== PERMISSION_MODE_KEY || change.scope !== "session") return;
  if (typeof change.value !== "string") return;
  const row = tx.get(`SELECT mode FROM cap_work_meta WHERE session_id = ?`, [event.threadId]);
  const previous = typeof row?.["mode"] === "string" ? row["mode"] : "default";
  if (change.value === "plan" && previous !== "plan") {
    tx.run(
      `INSERT INTO cap_work_meta (session_id, turns_completed, last_task_change_turn, mode, mode_before_plan, plan_entered_seq)
       VALUES (?, 0, 0, 'plan', ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET mode = 'plan', mode_before_plan = excluded.mode_before_plan,
         plan_entered_seq = excluded.plan_entered_seq`,
      [event.threadId, previous, event.seq],
    );
    return;
  }
  tx.run(
    `INSERT INTO cap_work_meta (session_id, turns_completed, last_task_change_turn, mode, plan_entered_seq)
     VALUES (?, 0, 0, ?, NULL)
     ON CONFLICT(session_id) DO UPDATE SET mode = excluded.mode,
       plan_entered_seq = CASE WHEN excluded.mode = 'plan' THEN plan_entered_seq ELSE NULL END`,
    [event.threadId, change.value],
  );
}

// ── 목표와 보고(spec §3.8) ──────────────────────────────────────────────────

function orderOf(id: string): number {
  return Number(id.slice(1));
}

function applyGoalSet(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { goal } = payloadOf(WorkGoalSetSchema, event);
  tx.run(
    `INSERT INTO cap_work_goals (session_id, goal_id, ord, goal, status, set_seq, set_at, settled_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      event.threadId,
      goal.goalId,
      orderOf(goal.goalId),
      JSON.stringify(goal),
      goal.status,
      event.seq,
      event.recordedAt,
    ],
  );
}

/** 저장된 Goal JSON을 읽는다. 목표 행이 없거나 깨졌으면 이벤트 순서나 투영이 잘못된 것이다 */
function goalOf(tx: ProjectionTx, event: DurableEventEnvelope, goalId: string): Goal {
  const row = tx.get(`SELECT goal FROM cap_work_goals WHERE session_id = ? AND goal_id = ?`, [
    event.threadId,
    goalId,
  ]);
  const text = row?.["goal"];
  if (typeof text !== "string")
    return failProjection(`${event.kind} has no goal ${goalId}`, undefined);
  const json = parseJson(text);
  if (!json.ok) return failProjection(`goal ${goalId} row is not JSON`, json.error);
  const goal = parse(GoalSchema, json.value);
  return goal.ok ? goal.value : failProjection(`goal ${goalId} row is damaged`, goal.error);
}

function applyGoalJudged(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const judged = payloadOf(WorkGoalJudgedSchema, event);
  tx.run(
    `INSERT INTO cap_work_judgments (session_id, goal_id, n, turn_id, judgment, seq)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [event.threadId, judged.goalId, judged.n, judged.turnId, JSON.stringify(judged), event.seq],
  );
  const goal = goalOf(tx, event, judged.goalId);
  const next: Goal = {
    ...goal,
    judgments: Math.max(goal.judgments, judged.n),
    lastVerdict: judged.verdict ?? goal.lastVerdict,
  };
  tx.run(`UPDATE cap_work_goals SET goal = ? WHERE session_id = ? AND goal_id = ?`, [
    JSON.stringify(next),
    event.threadId,
    judged.goalId,
  ]);
}

function applyGoalSettled(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const settled = payloadOf(WorkGoalSettledSchema, event);
  const goal = goalOf(tx, event, settled.goalId);
  const next: Goal = { ...goal, status: settled.status, judgments: settled.judgments };
  tx.run(
    `UPDATE cap_work_goals SET goal = ?, status = ?, settled_seq = ? WHERE session_id = ? AND goal_id = ?`,
    [JSON.stringify(next), settled.status, event.seq, event.threadId, settled.goalId],
  );
}

function applyReportBuilt(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const { report } = payloadOf(WorkReportBuiltSchema, event);
  tx.run(
    `INSERT INTO cap_work_reports (session_id, report_id, ord, report, seq) VALUES (?, ?, ?, ?, ?)`,
    [event.threadId, report.reportId, orderOf(report.reportId), JSON.stringify(report), event.seq],
  );
}

type Handler = (tx: ProjectionTx, event: DurableEventEnvelope) => void;

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ["work.task_created", applyCreated],
  ["work.task_changed", applyChanged],
  ["work.task_linked", applyLinked],
  ["work.task_unlinked", applyUnlinked],
  ["work.plan_submitted", applyPlanSubmitted],
  ["work.plan_withdrawn", applyPlanWithdrawn],
  ["work.goal_set", applyGoalSet],
  ["work.goal_judged", applyGoalJudged],
  ["work.goal_settled", applyGoalSettled],
  ["work.report_built", applyReportBuilt],
  ["approval.requested", applyApprovalRequested],
  ["approval.resolved", applyApprovalResolved],
  ["settings.changed", applySettingsChanged],
  ["turn.completed", applyTurnCompleted],
]);

export function createWorkProjector(): Projector {
  return {
    name: WORK_PROJECTOR_NAME,
    version: WORK_PROJECTOR_VERSION,
    tables: WORK_PROJECTOR_TABLES,
    ddl: WORK_PROJECTOR_DDL,
    kinds: WORK_PROJECTOR_KINDS,
    apply(tx, event) {
      HANDLERS.get(event.kind)?.(tx, event);
    },
  };
}
