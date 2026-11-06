// src/state/engine/hooks.ts
import { Bug } from "@fresnel/contracts";
import type {
  EventId,
  ItemId,
  ItemRecord,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { StatusItemRecord } from "@fresnel/contracts/records";
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
  PlanRecord,
  QueuedInput,
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
  return useStore(useEngineStore(), useShallow(selector));
}

/** 엔진 내부 일로 만든 대화(`spawnedBy.kind === "internal"`)는 목록·이동에서 뺀다 [결정: 오케스트레이터 기본값, rtE R-3] */
const hiddenFromList = (summary: ThreadSummary | undefined): boolean =>
  summary?.spawnedBy?.kind === "internal";
export const useThreadIds = (): readonly ThreadId[] =>
  useEngine(
    useShallow((s: EngineMirror) =>
      s.threads.ids.filter((id) => !hiddenFromList(sel.selectThread(s, id))),
    ),
  );
export const useThread = (id: ThreadId): ThreadSummary | undefined =>
  useEngine((s) => sel.selectThread(s, id));
/** 목록 순서(최근 활동 먼저)의 대화 요약. 셸의 맥락 칸이 쓴다. 엔진 내부 대화는 없다 */
export const useThreadSummaries = (): readonly ThreadSummary[] =>
  useEngine(
    useShallow((s: EngineMirror) =>
      s.threads.ids.flatMap((id) => {
        const summary = sel.selectThread(s, id);
        return summary === undefined || hiddenFromList(summary) ? [] : [summary];
      }),
    ),
  );
/** 내부 대화까지 포함한 요약. 대기 승인의 대화 이름처럼 숨기면 안 되는 곳만 쓴다 */
export const useAllThreadSummaries = (): readonly ThreadSummary[] =>
  useEngine(
    useShallow((s: EngineMirror) =>
      s.threads.ids.flatMap((id) => {
        const summary = sel.selectThread(s, id);
        return summary === undefined ? [] : [summary];
      }),
    ),
  );
export const useTranscriptItemIds = (): readonly ItemId[] => useEngine(sel.selectTranscriptItemIds);
export const useItem = (id: ItemId): ItemRecord | undefined =>
  useEngine((s) => sel.selectItem(s, id));
export const useToolResult = (toolCallId: string): ItemRecord | undefined =>
  useEngine((s) => sel.selectToolResult(s, toolCallId));
export const useHasToolCall = (toolCallId: string): boolean =>
  useEngine((s) => sel.selectHasToolCall(s, toolCallId));
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
export const useReadyThreadId = (): ThreadId | null => useEngine(sel.selectReadyThreadId);
export const useUnlistedApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectUnlistedApprovals(s, id));
export const useThreadApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectThreadApprovals(s, id));
export const useToolCallAwaitingApproval = (toolCallId: string): boolean =>
  useEngine((s) => sel.selectToolCallAwaitingApproval(s, toolCallId));
export const useOpenThread = (): ThreadSummary | undefined => useEngine(sel.selectOpenThread);
export const useOpenThreadRunning = (): boolean => useEngine(sel.selectOpenThreadRunning);
export const useThreadRunning = (id: ThreadId): boolean =>
  useEngine((s) => sel.selectThreadRunning(s, id));
export const useUnsentUserItemId = (): ItemId | null => useEngine(sel.selectUnsentUserItemId);
export const useLastUserText = (): string | null => useEngine(sel.selectLastUserText);
export const useTurnFailure = (id: ThreadId | null): string | null =>
  useEngine((s) => sel.selectTurnFailure(s, id));
/** 대화별 실패로 끝난 마지막 turn의 문장. 진행 중 칸이 예약 실패 행을 고른다 */
export const useTurnFailures = (): Readonly<Record<string, string>> =>
  useEngine(sel.selectTurnFailures);
export const useLatestTurnId = (id: ThreadId | null): TurnId | null =>
  useEngine((s) => sel.selectLatestTurnId(s, id));
export const useRecentTurnIds = (id: string | null): readonly TurnId[] =>
  useEngine((s) => sel.selectRecentTurnIds(s, id));
export const useApprovalCount = (): number => useEngine(sel.selectApprovalCount);
/** 받은 확장 핸들러 실패 기록(휘발, 최대 500행). 확장별로 거르는 일은 화면이 한다 */
export const useHandlerFailures = (): EngineMirror["handlerFailures"] =>
  useEngine(sel.selectHandlerFailures);
/** 이 대화의 전환 기록(받은 순서, 대화마다 최대 20개). 대화가 없으면 빈 목록이다. 기록이 같으면 같은 참조를 준다 */
export const useTransitions = (threadId: ThreadId | null): readonly TransitionRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectTransitions(s, threadId)));
/** 이 대화의 계획 기록(받은 순서, 가장 최근 것이 뒤, 대화마다 최대 20개). 계획 카드가 최근 계획의 id를 고른다 */
export const usePlans = (threadId: ThreadId | null): readonly PlanRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectPlans(s, threadId)));
/** 이 대화의 아직 배치되지 않은 대기 입력(받은 순서, 대화마다 최대 20개). 입력창 위 칩이 쓴다 */
export const useQueuedInputs = (threadId: ThreadId | null): readonly QueuedInput[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectQueuedInputs(s, threadId)));
/** 변경 검토 결과(리뷰마다 가장 최근 라운드 하나). 제출 결과 표가 리뷰 id로 찾는다 */
export const useReviewResults = (): EngineMirror["reviewResults"] =>
  useEngine((s) => s.reviewResults);
/** 이 대화의 상태줄 칸(B-09). 열 때 `status.list`로 채우고 `dialog.status`가 바꾼다 */
export const useStatusItems = (threadId: ThreadId | null): readonly StatusItemRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectStatusItems(s, threadId)));
