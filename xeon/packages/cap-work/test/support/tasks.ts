import { Bug, parse } from "@xeon/contracts";
import {
  WorkTaskIdSchema,
  type WorkTask,
  type WorkTaskId,
  type WorkTaskStatus,
} from "@xeon/contracts/capabilities";

/** 문자열을 작업 ID로 좁힌다. 형식이 틀리면 시험 입력의 결함이다 */
export function tid(raw: string): WorkTaskId {
  const parsed = parse(WorkTaskIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a task id`);
  return parsed.value;
}

export function task(
  id: string,
  status: WorkTaskStatus = "pending",
  blockedBy: readonly string[] = [],
  owner: string | null = null,
): WorkTask {
  return {
    id: tid(id),
    content: `task ${id}`,
    activeForm: null,
    status,
    owner,
    blockedBy: blockedBy.map(tid),
  };
}

export function ids(...raw: readonly string[]): WorkTaskId[] {
  return raw.map(tid);
}
