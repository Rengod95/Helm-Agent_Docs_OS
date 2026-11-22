// 테스트 챗 창을 여는 길과 창의 드래프트 줄을 읽는 훅. 입구(플러그인 상세의 "테스트 챗", 개요의 "새로 만들기", 메트릭의 "고치기"·"막기로 올리기")가
// 모두 `useOpenTestChat`을 부른다. 창은 바로 서고(머리와 뼈대), `craftChat.open`의 답이 오면 그 대화를 그린다.
import { useCallback, useEffect, useState } from "react";
import { detach, err, ok, rethrow, type Result } from "@fresnel/contracts";
import type { ContextRef, ThreadId } from "@fresnel/contracts/conversation";
import { useThread } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { draftRowOf, type DraftRow } from "./window-model.ts";
import { dispatchTestChat } from "./window-state.ts";

export interface TestChatRequest {
  /** 묶을 플러그인. null이면 새 플러그인을 만드는 대화다 */
  readonly plugin: string | null;
  /** 들고 갈 맥락(엔진이 열 때 한 번 기록한다). 비면 보내지 않는다 */
  readonly context?: readonly ContextRef[];
  /** "last"면 그 플러그인의 가장 최근 테스트 챗을 다시 연다(없으면 만든다). 기본 "last" */
  readonly reuse?: "last" | "new";
}

export function useOpenTestChat(): (
  request: TestChatRequest,
) => Promise<Result<null, CommandError>> {
  const commands = useCommands();
  const shell = useShellActions();
  return useCallback(
    async (request) => {
      const context = request.context ?? [];
      // 창은 Craft에만 뜬다. 대화 영역의 입구(플러그인 상세가 대화 영역에서 열린 경우)에서 눌러도 Craft로 간다
      shell.switchArea("workbench");
      dispatchTestChat({ type: "opening", plugin: request.plugin, contexts: context });
      const opened = await commands.testChat.open({
        plugin: request.plugin,
        reuse: request.reuse ?? "last",
        ...(context.length === 0 ? {} : { context: [...context] }),
      });
      if (!opened.ok) {
        dispatchTestChat({ type: "failed", error: opened.error });
        return err(opened.error);
      }
      dispatchTestChat({
        type: "opened",
        threadId: opened.value.threadId,
        plugin: opened.value.plugin,
      });
      return ok(null);
    },
    [commands, shell],
  );
}

/** 창 안 드래프트 줄의 읽기 상태. 플러그인에 아직 묶이지 않았으면 드래프트가 없다 */
export type DraftRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly row: DraftRow }
  | { readonly kind: "failed" };

/**
 * 이 대화가 만든 가장 새 드래프트(`plugin.draft.list { name }`의 `originThreadId`). 엔진에 드래프트 변화 알림이 없어
 * 창이 열릴 때, 턴이 끝날 때(대화 상태가 바뀔 때), 리뷰로 보낸 뒤(`reload`)에 다시 읽는다
 */
export function useTestChatDraft(
  threadId: ThreadId,
  plugin: string | null,
): { readonly read: DraftRead; readonly reload: () => void } {
  const commands = useCommands();
  const summary = useThread(threadId);
  const status = summary?.status;
  const lastTurnId = summary?.lastTurnId;
  const [nonce, setNonce] = useState(0);
  const [read, setRead] = useState<DraftRead>({ kind: "loading" });
  useEffect(() => {
    if (plugin === null) {
      setRead({ kind: "ready", row: { kind: "none" } });
      return undefined;
    }
    let live = true;
    detach(
      commands.workbench.drafts(plugin).then((got) => {
        if (!live) return undefined;
        setRead(
          got.ok ? { kind: "ready", row: draftRowOf(got.value, threadId) } : { kind: "failed" },
        );
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [commands, plugin, threadId, status, lastTurnId, nonce]);
  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);
  return { read, reload };
}
