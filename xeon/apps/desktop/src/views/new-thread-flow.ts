import type { Result } from "@fresnel/contracts";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { useThreadSummaries } from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useShellActions } from "../state/shell/index.ts";
import { useCommands, type CommandError } from "./commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "./folder-pick.ts";
import { blankThreadIn, planNewThread, type NewThreadPlan } from "./new-thread-model.ts";

// 새 대화를 만드는 길 하나(R5). ⌘N, 팔레트, 트레이, 사이드바 "새 대화"가 모두 이 함수를 부른다.
// 보던 대화의 작업 폴더에서 열고, 보낸 것 없는 빈 대화가 있으면 그리로 가고, 폴더를 모르면 폴더 고르기를 연다(취소하면 아무것도 만들지 않는다).
// 어느 길이든 대화가 열리면 입력창에 초점을 요청한다. 폴더 고르기 창은 하나만 연다.

export type NewThreadResult =
  | { readonly kind: "opened" }
  | { readonly kind: "created" }
  /** 폴더 고르기를 취소했다. 아무것도 만들지 않았다 */
  | { readonly kind: "cancelled" }
  /** 폴더 고르기 창이 이미 열려 있어 이번 요청은 버렸다 */
  | { readonly kind: "busy" }
  | { readonly kind: "pickFailed" }
  | { readonly kind: "failed"; readonly error: CommandError };

/** 폴더 고르기 창이 열려 있는 동안 참이다. ⌘N을 여러 번 눌러도 OS 창이 쌓이지 않게 모든 진입이 같은 값을 본다 */
const pickGuard = { open: false };

/** 시험에서 창이 열린 채로 남은 상태를 비운다 */
export function resetNewThreadGuard(): void {
  pickGuard.open = false;
}

/** 흐름이 쓰는 것들. 화면 훅이 채우고, 시험은 가짜를 넣는다 */
export interface NewThreadDeps {
  readonly threads: readonly ThreadSummary[];
  readonly selected: ThreadSummary["threadId"] | null;
  readonly folderPick: FolderPickInvoke | undefined;
  /** 대화 영역의 입력창이 보이는 화면으로 바꾼다(설정 화면에서 눌러도 대화가 보인다) */
  readonly showChat: () => void;
  readonly selectThread: (threadId: ThreadSummary["threadId"]) => void;
  readonly requestComposer: () => void;
  readonly createThread: (workspace: string | undefined) => Promise<Result<null, CommandError>>;
}

/** `explicit`: `undefined`는 보던 폴더에서(없으면 고르기), 글은 그 폴더, `null`은 대화 상자의 "폴더 없이 만들기"다 */
export async function runNewThread(
  deps: NewThreadDeps,
  explicit: string | null | undefined,
): Promise<NewThreadResult> {
  const { threads } = deps;
  const goTo = (threadId: ThreadSummary["threadId"]): NewThreadResult => {
    deps.selectThread(threadId);
    deps.requestComposer();
    return { kind: "opened" };
  };
  const plan: NewThreadPlan =
    explicit === undefined
      ? planNewThread(threads, deps.selected)
      : explicit === null
        ? { kind: "createNoFolder" }
        : { kind: "create", workspace: explicit };
  deps.showChat();
  if (plan.kind === "open") return goTo(plan.threadId);
  let workspace: string | undefined;
  if (plan.kind === "create") workspace = plan.workspace;
  else if (plan.kind === "pickFolder" && deps.folderPick !== undefined) {
    if (pickGuard.open) return { kind: "busy" };
    pickGuard.open = true;
    const picked = await pickWorkspaceFolder(deps.folderPick).finally(() => {
      pickGuard.open = false;
    });
    if (!picked.ok) return { kind: "pickFailed" };
    if (picked.value === undefined) return { kind: "cancelled" };
    workspace = picked.value;
  }
  // 고른 폴더(폴더 선택 창이 없는 환경이면 폴더 없음)에 빈 새 대화가 이미 있으면 새로 만들지 않는다
  const blank = blankThreadIn(threads, workspace ?? null);
  if (blank !== null) return goTo(blank);
  const created = await deps.createThread(workspace);
  if (!created.ok) return { kind: "failed", error: created.error };
  deps.requestComposer();
  return { kind: "created" };
}

export function useStartNewThread(
  folderPick: FolderPickInvoke | undefined,
): (workspace?: string | null) => Promise<NewThreadResult> {
  const commands = useCommands();
  const shell = useShellActions();
  const threads = useThreadSummaries();
  const selected = useSelectedThreadId();
  return (explicit) =>
    runNewThread(
      {
        threads,
        selected,
        folderPick,
        showChat: () => {
          const model = shell.snapshot();
          shell.switchArea("chat");
          commands.showScreen("chat");
          if (model.places.chat.screen !== "chat") shell.updatePlace({ screen: "chat", scroll: 0 });
        },
        selectThread: (threadId) => {
          commands.selectThread(threadId);
        },
        requestComposer: () => {
          commands.requestComposer(null);
        },
        createThread: (workspace) => commands.createThread(workspace),
      },
      explicit,
    );
}
