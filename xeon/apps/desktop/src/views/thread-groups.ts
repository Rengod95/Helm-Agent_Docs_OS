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

/** 엔진 내부 일(학습 검토 등)로 만든 대화인가. 목록·팔레트·받은 요청 선택에서 숨긴다(대화는 지우지 않는다) [결정: 오케스트레이터 기본값, rtE R-3] */
function isInternalThread(thread: Pick<ThreadSummary, "spawnedBy">): boolean {
  return thread.spawnedBy?.kind === "internal";
}

/** 사이드바의 행 하나. `child`이면 부모 행 아래 들여 쓴 하위 행이다 */
export interface SidebarRow {
  readonly thread: ThreadSummary;
  readonly child: boolean;
}

/**
 * 사이드바 묶음. 내부 대화는 뺀다. 하위 대화는 작업 폴더가 없으면 부모의 작업 폴더 묶음에 들고 부모 바로 아래에 온다.
 * 부모가 목록에 없으면 그 대화가 자기 자리에 보인다. 목록 순서(최근 활동 먼저)는 지킨다
 */
export function sidebarGroupsOf(
  threads: readonly ThreadSummary[],
): readonly ThreadGroup<SidebarRow>[] {
  const visible = threads.filter((thread) => !isInternalThread(thread));
  const ids = new Set(visible.map((thread) => thread.threadId));
  const childrenOf = new Map<string, ThreadSummary[]>();
  const tops: ThreadSummary[] = [];
  for (const thread of visible) {
    const parent = thread.spawnedBy?.threadId;
    if (parent === undefined || !ids.has(parent) || parent === thread.threadId) {
      tops.push(thread);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [thread]);
    else siblings.push(thread);
  }
  const rows: (SidebarRow & { readonly workspace: string | null })[] = [];
  for (const top of tops) {
    const workspace = top.workspace ?? null;
    rows.push({ thread: top, child: false, workspace });
    // 손자까지 같은 규칙으로 부모 아래에 둔다
    const walk = (parentId: string, seen: ReadonlySet<string>): void => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (seen.has(child.threadId)) continue;
        rows.push({ thread: child, child: true, workspace });
        walk(child.threadId, new Set([...seen, child.threadId]));
      }
    };
    walk(top.threadId, new Set([top.threadId]));
  }
  return groupByWorkspace(rows).map((group) => ({
    workspace: group.workspace,
    items: group.items.map((row) => ({ thread: row.thread, child: row.child })),
  }));
}
