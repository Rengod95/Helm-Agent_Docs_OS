import type { ThreadSummary } from "@fresnel/contracts/wire";

// ⌘N·팔레트 "새 대화"가 무엇을 할지 정한다(W6). [기본값: 사용자 결정 없음]
// - 지금 보는 대화의 작업 폴더가 있으면 그 폴더에서 새 대화를 연다.
// - 아직 아무것도 보내지 않은 빈 새 대화가 그 폴더에 이미 있으면 새로 만들지 않고 그것으로 간다.
// - 작업 폴더를 모르면 폴더 고르기를 연다(폴더 없는 대화를 쌓지 않는다).

export type NewThreadPlan =
  | { readonly kind: "open"; readonly threadId: ThreadSummary["threadId"] }
  | { readonly kind: "create"; readonly workspace: string }
  | { readonly kind: "pickFolder" };

/** 보낸 것이 없는 새 대화: 턴이 없고, 제목이 없고, 분기·시험 표식이 없고, 닫히지 않았다 */
export function isBlankThread(thread: ThreadSummary): boolean {
  return (
    thread.lastTurnId === undefined &&
    thread.title === null &&
    thread.forkedFrom === null &&
    thread.testRun === undefined &&
    thread.status !== "closed" &&
    thread.resumable === null
  );
}

/** 그 작업 폴더(null은 폴더 없음)의 빈 새 대화. 없으면 null */
export function blankThreadIn(
  threads: readonly ThreadSummary[],
  workspace: string | null,
): ThreadSummary["threadId"] | null {
  const blank = threads.find((thread) => thread.workspace === workspace && isBlankThread(thread));
  return blank === undefined ? null : blank.threadId;
}

/** 최근 작업 폴더 후보의 최대 개수(시안 O-07 "최근") */
const RECENT_WORKSPACE_MAX = 5;

/** 최근 작업 폴더 한 줄. `path`는 보내는 값(절대 경로)이고 `count`는 그 폴더의 대화 수다 */
export interface RecentWorkspace {
  readonly path: string;
  readonly count: number;
}

/**
 * 최근 작업 폴더 후보. 대화 목록은 최근 활동 먼저이므로 폴더가 처음 나온 순서를 그대로 둔다.
 * 빈 글과 폴더 없음은 뺀다. 대화 수는 그 폴더에 든 모든 대화다. 최대 5개다
 */
export function recentWorkspacesOf(threads: readonly ThreadSummary[]): readonly RecentWorkspace[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const path = thread.workspace;
    if (path === null || path.trim() === "") continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts].slice(0, RECENT_WORKSPACE_MAX).map(([path, count]) => ({ path, count }));
}

export function planNewThread(
  threads: readonly ThreadSummary[],
  selectedId: ThreadSummary["threadId"] | null,
): NewThreadPlan {
  const selected = threads.find((thread) => thread.threadId === selectedId);
  const workspace = selected?.workspace ?? null;
  if (workspace === null) return { kind: "pickFolder" };
  const blank = blankThreadIn(threads, workspace);
  if (blank !== null) return { kind: "open", threadId: blank };
  return { kind: "create", workspace };
}
