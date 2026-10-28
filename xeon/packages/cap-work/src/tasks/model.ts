import type {
  WorkTask,
  WorkTaskId,
  WorkTaskStatus,
  WorkTaskView,
} from "@xeon/contracts/capabilities";

// L2.work.spec §4.1.2~§4.1.3. 상태 전이 표와 막힘 계산. 순수 함수다.

/** 전이 표의 칸: same 변화 없음, allowed 허용, check_blocked 허용하되 막힘 검사, invalid 거부 */
export type Transition = "same" | "allowed" | "check_blocked" | "invalid";

const TRANSITIONS: Readonly<Record<WorkTaskStatus, Readonly<Record<WorkTaskStatus, Transition>>>> =
  {
    pending: {
      pending: "same",
      in_progress: "check_blocked",
      completed: "allowed",
      failed: "invalid",
      cancelled: "allowed",
    },
    in_progress: {
      pending: "allowed",
      in_progress: "same",
      completed: "allowed",
      failed: "allowed",
      cancelled: "allowed",
    },
    completed: {
      pending: "allowed",
      in_progress: "invalid",
      completed: "same",
      failed: "invalid",
      cancelled: "invalid",
    },
    failed: {
      pending: "allowed",
      in_progress: "check_blocked",
      completed: "invalid",
      failed: "same",
      cancelled: "allowed",
    },
    cancelled: {
      pending: "allowed",
      in_progress: "invalid",
      completed: "invalid",
      failed: "invalid",
      cancelled: "same",
    },
  };

export const TASK_STATUSES: readonly WorkTaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
];

export function transitionOf(from: WorkTaskStatus, to: WorkTaskStatus): Transition {
  return TRANSITIONS[from][to];
}

/** 선행 작업으로서 막힘을 풀어 주는 상태. failed는 막힘을 유지한다(spec §4.1.3, W-11) */
export function isResolved(status: WorkTaskStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export type TaskIndex = ReadonlyMap<WorkTaskId, WorkTask>;

export function indexTasks(tasks: readonly WorkTask[]): TaskIndex {
  return new Map(tasks.map((task) => [task.id, task]));
}

/** 끝나지 않은 선행 작업. 목록에 없는 선행 작업은 이미 지워진 것이 아니라 읽기 오류이므로 막힘으로 세지 않는다 */
export function blockersOf(task: WorkTask, index: TaskIndex): WorkTaskId[] {
  return task.blockedBy.filter((id) => {
    const blocker = index.get(id);
    return blocker !== undefined && !isResolved(blocker.status);
  });
}

/** 조회용 보기: blocked(계산)와 blocks(역방향 간선)를 더한다. 입력 순서를 지킨다 */
export function toViews(tasks: readonly WorkTask[]): WorkTaskView[] {
  const index = indexTasks(tasks);
  const blocks = new Map<WorkTaskId, WorkTaskId[]>();
  for (const task of tasks) {
    for (const blocker of task.blockedBy) {
      const list = blocks.get(blocker) ?? [];
      list.push(task.id);
      blocks.set(blocker, list);
    }
  }
  return tasks.map((task) => ({
    ...task,
    blockedBy: [...task.blockedBy],
    blocked: blockersOf(task, index).length > 0,
    blocks: blocks.get(task.id) ?? [],
  }));
}
