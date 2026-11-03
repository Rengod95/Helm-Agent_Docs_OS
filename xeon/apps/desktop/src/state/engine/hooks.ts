// src/state/engine/hooks.ts
import { Bug } from "@fresnel/contracts";
import type {
  EventId,
  ItemId,
  ItemRecord,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ReadonlyStore } from "../shared/readonly-store.ts";
import * as sel from "./selectors.ts";
import type { EngineState } from "../../transport/ipc.ts";
import type {
  EngineMirror,
  Link,
  PendingApproval,
  StreamingItem,
  TransitionRecord,
} from "./state.ts";

export const EngineStoreContext: React.Context<ReadonlyStore<EngineMirror> | null> =
  createContext<ReadonlyStore<EngineMirror> | null>(null);

function useEngineStore(): ReadonlyStore<EngineMirror> {
  const store = useContext(EngineStoreContext);
  if (store === null) throw new Bug("EngineStoreContext provider is missing");
  return store;
}

/** 모듈 안에서만 쓴다. 화면은 아래 도메인 훅만 쓴다 */
function useEngine<U>(selector: (state: EngineMirror) => U): U {
  return useStore(useEngineStore(), selector);
}

export const useThreadIds = (): readonly ThreadId[] => useEngine(sel.selectThreadIds);
export const useThread = (id: ThreadId): ThreadSummary | undefined =>
  useEngine((s) => sel.selectThread(s, id));
/** 목록 순서(최근 활동 먼저)의 대화 요약. 셸의 맥락 칸이 쓴다 */
export const useThreadSummaries = (): readonly ThreadSummary[] =>
  useEngine(
    useShallow((s: EngineMirror) =>
      s.threads.ids.flatMap((id) => {
        const summary = sel.selectThread(s, id);
        return summary === undefined ? [] : [summary];
      }),
    ),
  );
export const useRecentWorkspaces = (limit: number): readonly string[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectRecentWorkspaces(s, limit)));
export const useTranscriptItemIds = (): readonly ItemId[] => useEngine(sel.selectTranscriptItemIds);
export const useItem = (id: ItemId): ItemRecord | undefined =>
  useEngine((s) => sel.selectItem(s, id));
export const useStreamingIds = (): readonly ItemId[] => useEngine(sel.selectStreamingIds);
export const useStreamingItem = (id: ItemId): StreamingItem | undefined =>
  useEngine((s) => sel.selectStreamingItem(s, id));
export const usePartText = (id: ItemId, contentIndex: number): string =>
  useEngine((s) => sel.selectPartText(s, id, contentIndex));
export const useApprovalIds = (): readonly EventId[] => useEngine(sel.selectApprovalIds);
export const useApproval = (id: EventId): PendingApproval | undefined =>
  useEngine((s) => sel.selectApproval(s, id));
export const useApprovalMirror = (): EngineMirror["approvals"] => useEngine((s) => s.approvals);
export const useRunningCount = (): number => useEngine(sel.selectRunningCount);
export const useLinkBanner = (): { readonly phase: Link["phase"]; readonly attempt: number } =>
  useEngine(useShallow(sel.selectLinkBanner));
export const useEngineState = (): EngineState | null => useEngine(sel.selectEngine);
export const useLinkPhase = (): Link["phase"] => useEngine(sel.selectLinkPhase);
export const useThreadsStatus = (): EngineMirror["threads"]["status"] =>
  useEngine(sel.selectThreadsStatus);
export const useTranscriptStatus = (): "none" | "loading" | "ready" | "error" =>
  useEngine(sel.selectTranscriptStatus);
export const useOpenThreadId = (): ThreadId | null => useEngine(sel.selectOpenThreadId);
export const useUnlistedApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectUnlistedApprovals(s, id));
export const useThreadRunning = (id: ThreadId): boolean =>
  useEngine((s) => sel.selectThreadRunning(s, id));
export const useTurnFailure = (id: ThreadId | null): string | null =>
  useEngine((s) => sel.selectTurnFailure(s, id));
export const useLatestTurnId = (id: ThreadId | null): TurnId | null =>
  useEngine((s) => sel.selectLatestTurnId(s, id));
export const useApprovalCount = (): number => useEngine(sel.selectApprovalCount);
/** 받은 확장 핸들러 실패 기록(휘발, 최대 500행). 확장별로 거르는 일은 화면이 한다 */
export const useHandlerFailures = (): EngineMirror["handlerFailures"] =>
  useEngine(sel.selectHandlerFailures);
/** 이 대화의 전환 기록(받은 순서, 대화마다 최대 20개). 대화가 없으면 빈 목록이다. 기록이 같으면 같은 참조를 준다 */
export const useTransitions = (threadId: ThreadId | null): readonly TransitionRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectTransitions(s, threadId)));
