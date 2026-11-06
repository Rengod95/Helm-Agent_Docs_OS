// 대화 목록의 작업 폴더 묶음(시안 _shell start-panel). 목록 순서(최근 활동 먼저)를 지키고 폴더는 처음 나온 순서로 둔다.
// 폴더 없는 대화는 마지막 묶음이다.
import type { ThreadSummary } from "@fresnel/contracts/wire";

/**
 * 맥락 칸의 두 묶음(시안 start-panel의 plain·trials). 시험 대화(`testRun` 표식이 있는 대화)는 "시험" 묶음에만 들고,
 * "대화" 묶음에는 들지 않는다. 나머지 대화는 "대화" 묶음에만 든다. 목록 순서는 그대로다
 */
export function contextThreadGroupsOf(threads: readonly ThreadSummary[]): {
  readonly threads: readonly ThreadSummary[];
  readonly trials: readonly ThreadSummary[];
} {
  return {
    threads: threads.filter((thread) => thread.testRun === undefined),
    trials: threads.filter((thread) => thread.testRun !== undefined),
  };
}

export interface ThreadGroup<T> {
  /** 작업 폴더 절대 경로. 폴더 없는 묶음은 null */
  readonly workspace: string | null;
  readonly items: readonly T[];
}

export function groupByWorkspace<T extends { readonly workspace?: string | null }>(
  threads: readonly T[],
): readonly ThreadGroup<T>[] {
  const byPath = new Map<string, T[]>();
  const none: T[] = [];
  for (const thread of threads) {
    const path = thread.workspace ?? null;
    if (path === null) {
      none.push(thread);
      continue;
    }
    const list = byPath.get(path);
    if (list === undefined) byPath.set(path, [thread]);
    else list.push(thread);
  }
  const groups: ThreadGroup<T>[] = [...byPath].map(([workspace, items]) => ({ workspace, items }));
  if (none.length > 0) groups.push({ workspace: null, items: none });
  return groups;
}

/** 묶음 머리에 보이는 짧은 경로: 마지막 두 마디. 앞이 잘렸으면 `…/`를 붙인다 */
export function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
