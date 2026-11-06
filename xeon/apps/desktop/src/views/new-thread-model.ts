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
