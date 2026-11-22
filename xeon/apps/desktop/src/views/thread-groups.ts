// 대화 목록의 작업 폴더 묶음(시안 _shell start-panel). 목록 순서(최근 활동 먼저)를 지키고 폴더는 처음 나온 순서로 둔다.
// 폴더 없는 대화는 마지막 묶음이다.
import type { ThreadSummary } from "@fresnel/contracts/wire";

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

/**
 * 묶음 머리의 두 부분(DP-150): 마지막 폴더 이름과 그 부모 경로. 부모는 화면에서 앞을 생략해 흐리게 둔다.
 * 끝의 구분자는 무시하고, 루트 바로 아래 폴더의 부모는 루트(`/`)다. 마디가 없으면 이름이 경로 그대로이고 부모는 빈 글이다
 */
export function folderPartsOf(path: string): { readonly name: string; readonly parent: string } {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (trimmed === "" || cut === -1) return { name: trimmed === "" ? path : trimmed, parent: "" };
  return {
    name: trimmed.slice(cut + 1),
    parent: cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut),
  };
}

/** 엔진 내부 일(학습 검토 등)로 만든 대화인가. 목록·팔레트·받은 요청 선택에서 숨긴다(대화는 지우지 않는다) [결정: 오케스트레이터 기본값, rtE R-3] */
function isInternalThread(thread: Pick<ThreadSummary, "spawnedBy">): boolean {
  return thread.spawnedBy?.kind === "internal";
}

/**
 * 보통 대화 목록(사이드바)에 둘 대화: 테스트 런 대화(`ThreadSummary.testRun` 표지, W-34)를 뺀다. 엔진의 `thread.list` 기본 목록은
 * 테스트 챗만 빼고 테스트 런은 준다(enTr 2026-11-20). 테스트 런은 Craft의 테스트 화면에서 열고 사이드바에는 두지 않는다(lcM6e, AGE-32).
 * 테스트 챗(`ThreadSummary.craftChat` 표지)도 뺀다. 엔진 기본 목록과 같은 기준이다(거울이 `thread.started`로 안 것도 포함).
 * 대화는 지우지 않고, 진행 중 묶음(상태 줄)과 테스트 화면은 그대로 본다. 목록 순서는 지킨다
 */
export function listedThreadsOf<T extends Pick<ThreadSummary, "testRun" | "craftChat">>(
  threads: readonly T[],
): readonly T[] {
  return threads.filter((thread) => thread.testRun === undefined && thread.craftChat === undefined);
}

/** 사이드바의 행 하나. `child`이면 부모 행 아래 들여 쓴 하위 행이다 */
export interface SidebarRow {
  readonly thread: ThreadSummary;
  readonly child: boolean;
}

/**
 * 사이드바 묶음. 내부 대화는 뺀다(테스트 런은 부르는 쪽이 `listedThreadsOf`로 먼저 뺀다).
 * 하위 대화는 작업 폴더가 없으면 부모의 작업 폴더 묶음에 들고 부모 바로 아래에 온다.
 * 부모가 목록에 없으면 그 대화가 자기 자리에 보인다. 목록 순서(최근 활동 먼저)는 지킨다
 */
export function sidebarGroupsOf(
  threads: readonly ThreadSummary[],
): readonly ThreadGroup<SidebarRow>[] {
  return groupByWorkspace(sidebarRowsOf(threads)).map((group) => ({
    workspace: group.workspace,
    items: group.items.map((row) => ({ thread: row.thread, child: row.child })),
  }));
}

/** 사이드바 줄을 묶기 전의 차례(하위 대화는 부모 바로 아래)와 각 줄이 묶일 작업 폴더. 프로젝트 패널도 이 차례를 쓴다 */
export function sidebarRowsOf(
  threads: readonly ThreadSummary[],
): readonly (SidebarRow & { readonly workspace: string | null })[] {
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
  return rows;
}
