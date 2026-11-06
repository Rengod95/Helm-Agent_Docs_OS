// src/state/engine/selectors.ts
import type {
  EventId,
  ItemId,
  ItemRecord,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { StatusItemRecord } from "@fresnel/contracts/records";
import type { ThreadSummary } from "@fresnel/contracts/wire";
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

// 빈 값은 모듈 상수다. 선택자가 [] 리터럴을 돌려주면 매번 새 참조라 재렌더가 끝나지 않는다
const NO_ITEMS: readonly ItemId[] = Object.freeze([]);
const NO_TRANSITIONS: readonly TransitionRecord[] = Object.freeze([]);
const NO_PLANS: readonly PlanRecord[] = Object.freeze([]);
const NO_QUEUED: readonly QueuedInput[] = Object.freeze([]);
const NO_STATUS: readonly StatusItemRecord[] = Object.freeze([]);

export const selectThreadIds = (s: EngineMirror): readonly ThreadId[] => s.threads.ids;
export const selectThread = (s: EngineMirror, id: ThreadId): ThreadSummary | undefined =>
  s.threads.byId[id];
export const selectTranscriptItemIds = (s: EngineMirror): readonly ItemId[] =>
  s.transcript?.status === "ready" ? s.transcript.itemIds : NO_ITEMS;
export const selectItem = (s: EngineMirror, id: ItemId): ItemRecord | undefined =>
  s.transcript?.status === "ready" ? s.transcript.items[id] : undefined;
export const selectStreamingIds = (s: EngineMirror): readonly ItemId[] => s.streaming.itemIds;
export const selectStreamingItem = (s: EngineMirror, id: ItemId): StreamingItem | undefined =>
  s.streaming.items[id];
/** 원시값을 돌려주므로 그 파트의 글자가 바뀔 때만 재렌더한다 */
export const selectPartText = (s: EngineMirror, id: ItemId, contentIndex: number): string =>
  s.streaming.items[id]?.parts.find((p) => p.contentIndex === contentIndex)?.text ?? "";
export const selectApprovalIds = (s: EngineMirror): readonly EventId[] => s.approvals.ids;
export const selectApproval = (s: EngineMirror, id: EventId): PendingApproval | undefined =>
  s.approvals.byId[id];
/** 원시값 집계. thread 수에 비례하지만 구독자가 상태 표시줄 하나다 */
export const selectRunningCount = (s: EngineMirror): number =>
  s.threads.ids.reduce((n, id) => (s.threads.byId[id]?.status === "running" ? n + 1 : n), 0);
/** 객체를 새로 만든다. 훅에서 useShallow로 감싼다 */
export const selectLinkBanner = (
  s: EngineMirror,
): { readonly phase: Link["phase"]; readonly attempt: number } => ({
  phase: s.link.phase,
  attempt: s.link.phase === "resync" || s.link.phase === "reset" ? s.link.attempt : 0,
});

/** 상태 객체의 기존 참조를 돌려준다 */
export const selectEngine = (s: EngineMirror): EngineState | null => s.engine;
export const selectLinkPhase = (s: EngineMirror): Link["phase"] => s.link.phase;
export const selectThreadsStatus = (s: EngineMirror): EngineMirror["threads"]["status"] =>
  s.threads.status;
export const selectTranscriptStatus = (s: EngineMirror): "none" | "loading" | "ready" | "error" =>
  s.transcript === null ? "none" : s.transcript.status;
export const selectOpenThreadId = (s: EngineMirror): ThreadId | null =>
  s.transcript?.threadId ?? null;
/** thread의 대기 승인 수 중 대기열에 항목이 없는 몫. approval.list가 없는 동안 재설정 뒤 복원하지 못한 승인을 알린다 */
export const selectUnlistedApprovals = (s: EngineMirror, id: ThreadId): number => {
  const pending = s.threads.byId[id]?.pendingApprovals ?? 0;
  if (pending === 0) return 0;
  let listed = 0;
  for (const approvalId of s.approvals.ids) {
    if (s.approvals.byId[approvalId]?.threadId === id) listed += 1;
  }
  return Math.max(0, pending - listed);
};
/** 이 thread에 진행 중인 turn이 있는지. 입력창이 중단 버튼을 보일지 정한다 */
export const selectThreadRunning = (s: EngineMirror, id: ThreadId): boolean =>
  s.threads.byId[id]?.status === "running";
export const selectTurnFailure = (s: EngineMirror, id: ThreadId | null): string | null =>
  id === null ? null : (s.turnFailures[id] ?? null);
/** thread의 가장 최근 turn id. 대화가 없거나 목록에도 거울의 turn.started에도 turn이 없으면 null이다(최근 실행은 잠긴다) */
export const selectLatestTurnId = (s: EngineMirror, id: ThreadId | null): TurnId | null =>
  id === null ? null : (s.latestTurnId[id] ?? null);
export const selectApprovalCount = (s: EngineMirror): number => s.approvals.ids.length;
export const selectHandlerFailures = (s: EngineMirror): EngineMirror["handlerFailures"] =>
  s.handlerFailures;

const NO_TURNS: readonly TurnId[] = Object.freeze([]);
/** 이 거울이 본 대화의 최근 turn id(오래된 것부터). 없으면 빈 목록 */
export const selectRecentTurnIds = (s: EngineMirror, id: string | null): readonly TurnId[] =>
  id === null ? NO_TURNS : (s.recentTurnIds[id] ?? NO_TURNS);

/** 이 대화의 전환 기록(받은 순서). 대화가 없으면 빈 목록이다. 배열을 새로 만들므로 훅에서 useShallow로 감싼다 */
export const selectTransitions = (
  s: EngineMirror,
  id: ThreadId | null,
): readonly TransitionRecord[] =>
  id === null ? NO_TRANSITIONS : s.transitions.filter((record) => record.threadId === id);

/** 이 대화의 계획 기록(받은 순서, 가장 최근 것이 뒤). 대화가 없으면 빈 목록이다. 배열을 새로 만들므로 훅에서 useShallow로 감싼다 */
export const selectPlans = (s: EngineMirror, id: ThreadId | null): readonly PlanRecord[] =>
  id === null ? NO_PLANS : s.plans.filter((record) => record.threadId === id);

/** 이 대화의 아직 배치되지 않은 대기 입력(받은 순서, 가장 최근 것이 뒤). 대화가 없으면 빈 목록이다. 배열을 새로 만들므로 훅에서 useShallow로 감싼다 */
export const selectQueuedInputs = (s: EngineMirror, id: ThreadId | null): readonly QueuedInput[] =>
  id === null ? NO_QUEUED : s.queuedInputs.filter((record) => record.threadId === id);

/** 이 대화의 상태줄 칸(`order` 작은 것이 앞, 같으면 받은 순서). 대화가 없거나 칸이 없으면 빈 목록이다. 배열을 새로 만들므로 훅에서 useShallow로 감싼다 */
export const selectStatusItems = (
  s: EngineMirror,
  id: ThreadId | null,
): readonly StatusItemRecord[] => {
  const items = id === null ? undefined : s.statusItems[id];
  if (items === undefined || items.length === 0) return NO_STATUS;
  return items.toSorted((a, b) => (a.order ?? 500) - (b.order ?? 500));
};
