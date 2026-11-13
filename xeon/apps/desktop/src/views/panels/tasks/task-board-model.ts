import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TaskRecord, ThreadTasks } from "../../../state/engine/index.ts";

// 작업 탭(DP-195)의 순수 모델. 모델이 `task_write`로 쓴 작업 기록을 사람이 읽는 판으로 나눈다:
// 지금 하는 것 하나(가장 크게), 다음(대기와 나머지 진행 중, 막힘은 이유와 함께), 실패, 끝남(완료·취소, 기본 접힘).
// 값은 거울(`selectTaskRecords`)에서 오고 사건마다 바뀐다. 시험은 `toEqual`로 비교한다.

type TaskStatus = TaskRecord["status"];

export interface BoardTask {
  readonly id: string;
  readonly content: string;
  /** 진행 중일 때 보이는 문장. 없으면 null */
  readonly activeForm: string | null;
  readonly status: TaskStatus;
  /** 맡은 쪽(하위 에이전트 이름 등). 없으면 null */
  readonly owner: string | null;
  /** 이 작업을 막고 있는 끝나지 않은 작업들의 내용(기록 순서). 막히지 않았으면 빈 목록 */
  readonly waitingOn: readonly string[];
}

export interface TaskBoard {
  /** 지금 하는 것(첫 진행 중 작업). 없으면 null */
  readonly current: BoardTask | null;
  /** 다음: 나머지 진행 중 작업, 그다음 대기 작업(기록 순서) */
  readonly next: readonly BoardTask[];
  readonly failed: readonly BoardTask[];
  /** 끝남: 완료와 취소(기록 순서) */
  readonly finished: readonly BoardTask[];
  /** 끝난 수와 센 수(취소는 세지 않는다) */
  readonly progress: { readonly done: number; readonly total: number };
  /** 막힌 작업 수(끝나지 않은 작업 중) */
  readonly blocked: number;
  readonly total: number;
}

function boardTaskOf(task: TaskRecord, byId: ReadonlyMap<string, TaskRecord>): BoardTask {
  const open = task.status === "pending" || task.status === "in_progress";
  const waitingOn = open
    ? task.blockedBy.flatMap((id): string[] => {
        const other = byId.get(id);
        return other === undefined || other.status === "completed" ? [] : [other.content];
      })
    : [];
  return {
    id: task.id,
    content: task.content,
    activeForm: task.activeForm,
    status: task.status,
    owner: task.owner,
    waitingOn,
  };
}

export function taskBoardOf(tasks: readonly TaskRecord[]): TaskBoard {
  const byId = new Map(tasks.map((task) => [String(task.id), task]));
  const all = tasks.map((task) => boardTaskOf(task, byId));
  const working = all.filter((task) => task.status === "in_progress");
  const current = working[0] ?? null;
  const next = [...working.slice(1), ...all.filter((task) => task.status === "pending")];
  const counted = all.filter((task) => task.status !== "cancelled");
  return {
    current,
    next,
    failed: all.filter((task) => task.status === "failed"),
    finished: all.filter((task) => task.status === "completed" || task.status === "cancelled"),
    progress: {
      done: counted.filter((task) => task.status === "completed").length,
      total: counted.length,
    },
    blocked: [current, ...next].filter((task) => task !== null && task.waitingOn.length > 0).length,
    total: all.length,
  };
}

/** 진행 막대 값(0~100). 센 작업이 없으면 0 */
export function progressPercentOf(progress: TaskBoard["progress"]): number {
  return progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
}

/** 대화가 열려 있지 않을 때 보이는 묶음 하나: 끝나지 않은 작업이 있는 대화 */
export interface OpenTaskGroup {
  readonly threadId: ThreadId;
  readonly done: number;
  readonly total: number;
  /** 지금 하는 작업(진행형 문장 우선) 또는 다음 작업의 내용 */
  readonly headline: string;
  /** 끝나지 않은 작업 수 */
  readonly open: number;
}

/** 열린 작업 묶음의 최대 수 */
export const OPEN_TASK_GROUPS_MAX = 5;

/** 끝나지 않은 작업이 있는 대화들(입력 순서 = 최근 활동 먼저), 최대 `OPEN_TASK_GROUPS_MAX`개 */
export function openTaskGroupsOf(threads: readonly ThreadTasks[]): readonly OpenTaskGroup[] {
  const groups = threads.flatMap((entry): OpenTaskGroup[] => {
    const board = taskBoardOf(entry.tasks);
    const lead = board.current ?? board.next[0] ?? null;
    if (lead === null) return [];
    return [
      {
        threadId: entry.threadId,
        done: board.progress.done,
        total: board.progress.total,
        headline: lead.status === "in_progress" ? (lead.activeForm ?? lead.content) : lead.content,
        open: (board.current === null ? 0 : 1) + board.next.length,
      },
    ];
  });
  return groups.slice(0, OPEN_TASK_GROUPS_MAX);
}
