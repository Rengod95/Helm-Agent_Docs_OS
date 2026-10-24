import { err, ok, parse, type Result } from "@xeon/contracts";
import { WorkTaskSchema, type WorkTask } from "@xeon/contracts/capabilities";
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
