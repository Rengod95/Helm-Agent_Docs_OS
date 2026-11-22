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
import * as csel from "./convo-select.ts";
import { hiddenFromLists } from "./listed.ts";
import { selectTranscriptShapes, type ItemShape } from "./transcript-shape.ts";
import type {
  AppliedProfile,
  ApprovalTrail,
  ConvoMarker,
  DriveInputRecord,
  Intervention,
  ToolProgress,
} from "./convo.ts";
import type { AnchoredCompaction } from "./compaction-anchor.ts";
import type { EngineState } from "../../transport/ipc.ts";
import type {
  EngineMirror,
  Link,
  PendingApproval,
  ProviderRetry,
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

/** 목록·이동에서 뺄 대화(엔진 내부 대화, 테스트 챗). 판정은 `listed.ts` [결정: 오케스트레이터 기본값, rtE R-3] */
const hiddenFromList = (summary: ThreadSummary | undefined): boolean => hiddenFromLists(summary);
export const useThreadIds = (): readonly ThreadId[] =>
  useEngine(
    useShallow((s: EngineMirror) =>
      s.threads.ids.filter((id) => !hiddenFromList(sel.selectThread(s, id))),
    ),
  );
export const useThread = (id: ThreadId): ThreadSummary | undefined =>
  useEngine((s) => sel.selectThread(s, id));
/** 목록 순서(최근 활동 먼저)의 대화 요약. 엔진 내부 대화는 없다 */
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
/** 열린 대화의 확정 item 모양(줄 모델용). 확정 item이 늘 때만 바뀐다 */
export const useTranscriptShapes = (): readonly ItemShape[] => useEngine(selectTranscriptShapes);
/** 여러 도구 호출의 결과 item(호출 순서). 결과가 아직 없으면 그 자리는 undefined다. 활동 묶음 머리가 읽는다 */
export const useToolResults = (
  toolCallIds: readonly string[],
): readonly (ItemRecord | undefined)[] =>
  useEngine((s) => toolCallIds.map((id) => sel.selectToolResult(s, id)));
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
export const useTranscriptFailure = (): "unavailable" | "failed" | "timeout" | "stale" | null =>
  useEngine(sel.selectTranscriptFailure);
export const useOpenThreadId = (): ThreadId | null => useEngine(sel.selectOpenThreadId);
export const useReadyThreadId = (): ThreadId | null => useEngine(sel.selectReadyThreadId);
export const useUnlistedApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectUnlistedApprovals(s, id));
export const useThreadApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectThreadApprovals(s, id));
export const useToolCallAwaitingApproval = (
  toolCallId: string,
  earlierCallIds: readonly string[],
): boolean => useEngine((s) => sel.selectToolCallAwaitingApproval(s, toolCallId, earlierCallIds));
export const useOpenThread = (): ThreadSummary | undefined => useEngine(sel.selectOpenThread);
export const useOpenThreadRunning = (): boolean => useEngine(sel.selectOpenThreadRunning);
export const useThreadRunning = (id: ThreadId): boolean =>
  useEngine((s) => sel.selectThreadRunning(s, id));
export const useAwaitingFirstResponse = (): boolean => useEngine(sel.selectAwaitingFirstResponse);
export const useUnsentUserItemId = (): ItemId | null => useEngine(sel.selectUnsentUserItemId);
export const useCustomCount = (kinds: readonly string[]): number =>
  useEngine((s) => sel.selectCustomCount(s, kinds));
export const useTranscriptTruncated = (): boolean => useEngine(sel.selectTranscriptTruncated);
export const useLastUserItemId = (): ItemId | null => useEngine(sel.selectLastUserItemId);
export const useLastUserText = (): string | null => useEngine(sel.selectLastUserText);
export const useTurnFailure = (id: ThreadId | null): string | null =>
  useEngine((s) => sel.selectTurnFailure(s, id));
/** 이 대화의 제공자 재시도 대기(휘발). 다음 응답이 오기 시작하거나 턴이 끝나면 null이 된다 */
export const useRetrying = (id: ThreadId | null): ProviderRetry | null =>
  useEngine((s) => sel.selectRetrying(s, id));
/** 대화별 실패로 끝난 마지막 turn의 문장. 진행 중 칸이 예약 실패 행을 고른다 */
export const useTurnFailures = (): Readonly<Record<string, string>> =>
  useEngine(sel.selectTurnFailures);
export const useLatestTurnId = (id: ThreadId | null): TurnId | null =>
  useEngine((s) => sel.selectLatestTurnId(s, id));
export const useRecentTurnIds = (id: string | null): readonly TurnId[] =>
  useEngine((s) => sel.selectRecentTurnIds(s, id));
export const useApprovalCount = (): number => useEngine(sel.selectApprovalCount);
/** 이 대화에 시한이 있는 대기 승인이 있는지 */
export const useApprovalUrgent = (id: ThreadId): boolean =>
  useEngine((s) => sel.selectApprovalUrgent(s, id));
/** 받은 확장 핸들러 실패 기록(휘발, 최대 500행). 확장별로 거르는 일은 화면이 한다 */
export const useHandlerFailures = (): EngineMirror["handlerFailures"] =>
  useEngine(sel.selectHandlerFailures);
/** 이 대화의 전환 기록(받은 순서, 대화마다 최대 20개). 대화가 없으면 빈 목록이다. 기록이 같으면 같은 참조를 준다 */
export const useTransitions = (threadId: ThreadId | null): readonly TransitionRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectTransitions(s, threadId)));
/** 이 대화의 요약 구분선 자리(열린 대화의 목록에 끼운다). 같은 기록이면 같은 참조다 */
export const useCompactionAnchors = (threadId: ThreadId | null): readonly AnchoredCompaction[] =>
  useEngine((s: EngineMirror) => sel.selectCompactionAnchors(s, threadId));
/** 이 대화의 아직 배치되지 않은 대기 입력(받은 순서, 대화마다 최대 20개). 입력창 위 칩이 쓴다 */
export const useQueuedInputs = (threadId: ThreadId | null): readonly QueuedInput[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectQueuedInputs(s, threadId)));
/** 변경 검토 결과(리뷰마다 가장 최근 라운드 하나). 제출 결과 표가 리뷰 id로 찾는다 */
export const useReviewResults = (): EngineMirror["reviewResults"] =>
  useEngine((s) => s.reviewResults);
/** 이 대화의 상태줄 칸(B-09). 열 때 `status.list`로 채우고 `dialog.status`가 바꾼다 */
export const useStatusItems = (threadId: ThreadId | null): readonly StatusItemRecord[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectStatusItems(s, threadId)));

// ── 대화 상태(`convo.ts`, `convo-select.ts`) ──────────────────────────
/** 도구 호출의 진행 출력(마지막 줄들과 받은 총량). 호출 id가 아직 없으면 item id로 찾는다 */
export const useToolProgress = (threadId: ThreadId, toolKey: string): ToolProgress | null =>
  useEngine((s) => csel.selectToolProgress(s, threadId, toolKey));
/** 도구 호출의 개입 목록(훅·가드 차단, 결과 고침, 샌드박스 우회, 시크릿 사용 등) */
export const useToolInterventions = (
  threadId: ThreadId,
  toolCallId: string,
): readonly Intervention[] =>
  useEngine((s) => csel.selectToolInterventions(s, threadId, toolCallId));
/** 도구 호출에 붙은 승인 기록 */
export const useToolApprovals = (
  threadId: ThreadId,
  toolCallId: string,
): readonly ApprovalTrail[] => useEngine((s) => csel.selectToolApprovals(s, threadId, toolCallId));
export const useTurnSummaries = (threadId: ThreadId): readonly csel.TurnSummary[] =>
  useEngine((s) => csel.selectTurnSummaries(s, threadId));
export const useTurnSummary = (threadId: ThreadId, turnId: TurnId): csel.TurnSummary | undefined =>
  useEngine((s) => csel.selectTurnSummary(s, threadId, turnId));
/** 멈추는 중인 턴이 있다 */
export const useAborting = (threadId: ThreadId): boolean =>
  useEngine((s) => csel.selectAborting(s, threadId));
export const useLeadSegments = (threadId: ThreadId): readonly csel.LeadSegment[] =>
  useEngine((s) => csel.selectLeadSegments(s, threadId));
export const useAgentRows = (threadId: ThreadId): readonly csel.AgentRow[] =>
  useEngine((s) => csel.selectAgentRows(s, threadId));
/** 입력창 위 "지금 띠": 목표, 판정, 할 일, 도는 하위 에이전트 수, 기다리는 승인 수 */
export const useNow = (threadId: ThreadId): csel.NowState =>
  useEngine((s) => csel.selectNow(s, threadId));
export const useConvoMarkers = (threadId: ThreadId): readonly ConvoMarker[] =>
  useEngine((s) => csel.selectMarkers(s, threadId));
/** 대화에 마지막으로 적용된 프로필(`profile.applied`). 못 봤으면 null */
export const useAppliedProfile = (threadId: ThreadId): AppliedProfile | null =>
  useEngine((s) => csel.selectAppliedProfile(s, threadId));
/** Drive가 받은 사용자 메시지 가운데 대화에 보일 것(M6a) */
export const useDriveInputs = (threadId: ThreadId): readonly DriveInputRecord[] =>
  useEngine((s) => csel.selectDriveInputs(s, threadId));
/** 도구 호출에 묶이지 않은 개입(시크릿 가림, 시크릿 승인) */
export const useLooseInterventions = (threadId: ThreadId): readonly Intervention[] =>
  useEngine((s) => csel.selectLooseInterventions(s, threadId));
/** 도구 호출 id 없는 승인(계획·질문·검토)의 기록 */
export const useLooseApprovals = (threadId: ThreadId): readonly ApprovalTrail[] =>
  useEngine((s) => csel.selectLooseApprovals(s, threadId));

/** 열린 대화의 확정 기록 한 벌. 변경 탭과 컨텍스트 탭이 item 인자(도구 호출, 시스템 접두)를 읽는다(DP-198, DP-203) */
export type OpenTranscriptView =
  | { readonly status: "none" | "loading" | "error" }
  | {
      readonly status: "ready";
      readonly threadId: ThreadId;
      readonly itemIds: readonly ItemId[];
      readonly items: Readonly<Record<string, ItemRecord>>;
      /** 읽는 상한에서 멈춰 오래된 item이 없다 */
      readonly truncated: boolean;
    };

/** 대화가 `threadId`일 때만 그 기록을 준다. 다른 대화가 열려 있으면 `none`이다. 같은 기록이면 같은 값이라 다시 그리지 않는다 */
export const useOpenTranscript = (threadId: ThreadId | null): OpenTranscriptView =>
  useEngine((s: EngineMirror): OpenTranscriptView => {
    const t = s.transcript;
    if (threadId === null || t === null || t.threadId !== threadId) return { status: "none" };
    if (t.status !== "ready") return { status: t.status };
    return {
      status: "ready",
      threadId: t.threadId,
      itemIds: t.itemIds,
      items: t.items,
      truncated: t.truncated === true,
    };
  });
/** 열린 대화의 작업 기록(DP-195). 사건마다 바뀐다 */
export const useTaskRecords = (threadId: ThreadId): readonly csel.TaskRecord[] =>
  useEngine((s) => csel.selectTaskRecords(s, threadId));
/** 작업 기록이 있는 대화들(최근 활동 먼저) */
export const useThreadsWithTasks = (): readonly csel.ThreadTasks[] =>
  useEngine(csel.selectThreadsWithTasks);
/** 실행 중 탭의 대화 값들(DP-196) */
export const useRunSources = (): readonly csel.RunSource[] => useEngine(csel.selectRunSources);
/** 도는 대화 수(엔진 내부 대화 제외) */
export const useRunningThreadCount = (): number => useEngine(csel.selectRunningThreadCount);
