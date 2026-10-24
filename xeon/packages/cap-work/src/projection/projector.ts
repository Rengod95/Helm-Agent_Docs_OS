import { Bug, parse } from "@xeon/contracts";
import type { TSchema, Static } from "typebox";
import {
  WorkTaskChangedSchema,
  WorkTaskCreatedSchema,
  WorkTaskLinkSchema,
  type DurableEventEnvelope,
  type EventKind,
  type ProjectionTx,
  type Projector,
} from "@xeon/contracts/records";
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
    tx.run(`INSERT INTO cap_work_task_edges (session_id, task_id, blocked_by) VALUES (?, ?, ?)`, [
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
      `INSERT OR IGNORE INTO cap_work_task_edges (session_id, task_id, blocked_by) VALUES (?, ?, ?)`,
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
    tx.run(
      `DELETE FROM cap_work_task_edges WHERE session_id = ? AND task_id = ? AND blocked_by = ?`,
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
  "turn.completed",
];

type Handler = (tx: ProjectionTx, event: DurableEventEnvelope) => void;

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ["work.task_created", applyCreated],
  ["work.task_changed", applyChanged],
  ["work.task_linked", applyLinked],
  ["work.task_unlinked", applyUnlinked],
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
