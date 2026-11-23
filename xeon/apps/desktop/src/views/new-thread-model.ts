import type { ThreadSummary } from "@fresnel/contracts/wire";

// ⌘N·팔레트 "새 대화"가 무엇을 할지 정한다(W6). [기본값: 사용자 결정 없음]
// - 지금 보는 대화의 작업 폴더가 있으면 그 폴더에서 새 대화를 연다.
// - 아직 아무것도 보내지 않은 빈 새 대화가 그 폴더에 이미 있으면 새로 만들지 않고 그것으로 간다.
// - 작업 폴더를 모르면(첫 실행, 폴더 없는 대화에서 누름) 폴더 없이 새 대화를 연다. 프로젝트는 직접 만들 때만 생기고 프로젝트 밖 대화는
//   "프로젝트 없는 대화"에 든다 [결정: 2026-11-22 사용자, AGE-34]. 폴더 고르기 창은 사용자가 대화 상자에서 직접 연다.

export type NewThreadPlan =
  | { readonly kind: "open"; readonly threadId: ThreadSummary["threadId"] }
  | { readonly kind: "create"; readonly workspace: string }
  /** 폴더 고르기 창을 연다(폴더가 꼭 필요한 부르는 쪽: 제작 대화, 폴더 고르기 단추) */
  | { readonly kind: "pickFolder" }
  /** 폴더 없이 만든다(새 대화 대화 상자의 "폴더 없이 만들기", 그리고 작업 폴더를 모르는 새 대화) */
  | { readonly kind: "createNoFolder" };

/**
 * 보낸 것이 없는 새 대화: 턴이 없고, 제목이 없고, 사용자 말(첫 입력 미리보기)도 대기 중인 입력도 없고, 분기·시험 표식이 없고, 닫히지 않았다.
 * Helm이 Drive한 대화처럼 사용자 말이 슬래시 명령뿐이어도 보낸 것이 있으면 빈 대화가 아니다
 */
export function isBlankThread(thread: ThreadSummary): boolean {
  return (
    thread.lastTurnId === undefined &&
    thread.title === null &&
    thread.preview === undefined &&
    thread.queuedInputs === 0 &&
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

/** 기본 폴더 설정이 빈 값일 때 데이터 폴더 아래의 폴더 이름(host `DEFAULT_PROJECT_FOLDER_NAME`과 같다) */
const DEFAULT_FOLDER_DIR = "default-project";

/**
 * 프로젝트 없는 대화의 기본 폴더인가: 끝 이름이 그 대화의 id이거나, 바로 위 폴더가 `default-project`다.
 * 대화 id를 모르면 위 폴더 이름만 본다
 */
export function isDefaultFolderPath(path: string, threadId?: string): boolean {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  if (threadId !== undefined && parts.at(-1) === threadId) return true;
  return parts.at(-2) === DEFAULT_FOLDER_DIR;
}

/**
 * 최근 작업 폴더 후보. 대화 목록은 최근 활동 먼저이므로 폴더가 처음 나온 순서를 그대로 둔다.
 * 빈 글과 폴더 없음은 뺀다. 프로젝트 없는 대화의 기본 폴더(`<기본 폴더>/<대화 id>`, 엔진 `defaultWorkspace`)는 그 대화만의 폴더라 뺀다. `<데이터>/default-project/` 아래는 대화 id와 달라도 뺀다(AGE-77 R-07).
 * 대화 수는 그 폴더에 든 모든 대화다. 최대 5개다
 */
export function recentWorkspacesOf(threads: readonly ThreadSummary[]): readonly RecentWorkspace[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const path = thread.workspace;
    if (path === null || path.trim() === "") continue;
    if (isDefaultFolderPath(path, thread.threadId)) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts].slice(0, RECENT_WORKSPACE_MAX).map(([path, count]) => ({ path, count }));
}

/** 작업 폴더를 모를 때 할 일: 폴더 없이 연다(사이드바, ⌘N, 팔레트) 또는 폴더 고르기 창을 연다(폴더가 꼭 필요한 부르는 쪽) */
export type WhenFolderUnknown = "noFolder" | "pick";

export function planNewThread(
  threads: readonly ThreadSummary[],
  selectedId: ThreadSummary["threadId"] | null,
  whenUnknown: WhenFolderUnknown = "noFolder",
): NewThreadPlan {
  const selected = threads.find((thread) => thread.threadId === selectedId);
  // 선택한 대화가 기본 폴더에 있으면 그 폴더는 그 대화만의 것이다. 새 대화가 물려받지 않고 폴더 없는 대화로 본다(AGE-77)
  const selectedFolder = selected?.workspace ?? null;
  const workspace =
    selectedFolder !== null && isDefaultFolderPath(selectedFolder, selected?.threadId)
      ? null
      : selectedFolder;
  if (workspace === null) {
    if (whenUnknown === "pick") return { kind: "pickFolder" };
    const blankNoFolder = blankThreadIn(threads, null);
    return blankNoFolder === null
      ? { kind: "createNoFolder" }
      : { kind: "open", threadId: blankNoFolder };
  }
  const blank = blankThreadIn(threads, workspace);
  if (blank !== null) return { kind: "open", threadId: blank };
  return { kind: "create", workspace };
}
