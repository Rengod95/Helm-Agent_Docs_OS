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

export const selectThread = (s: EngineMirror, id: ThreadId): ThreadSummary | undefined =>
  s.threads.byId[id];
export const selectTranscriptItemIds = (s: EngineMirror): readonly ItemId[] =>
  s.transcript?.status === "ready" ? s.transcript.itemIds : NO_ITEMS;
export const selectItem = (s: EngineMirror, id: ItemId): ItemRecord | undefined =>
  s.transcript?.status === "ready" ? s.transcript.items[id] : undefined;
// 호출 id → 결과 item. 확정 item 맵이 바뀔 때만 다시 만든다(호출 행마다 전체를 훑지 않는다)
const resultIndexCache = new WeakMap<object, ReadonlyMap<string, ItemRecord>>();
function resultIndexOf(
  items: Readonly<Record<string, ItemRecord>>,
): ReadonlyMap<string, ItemRecord> {
  const known = resultIndexCache.get(items);
  if (known !== undefined) return known;
  const index = new Map<string, ItemRecord>();
  for (const item of Object.values(items)) {
    if (item.kind === "toolResult") index.set(item.message.toolCallId, item);
  }
  resultIndexCache.set(items, index);
  return index;
}
/** 호출 id의 결과 item. 아직 없으면 undefined다 */
export const selectToolResult = (s: EngineMirror, toolCallId: string): ItemRecord | undefined =>
  s.transcript?.status === "ready" ? resultIndexOf(s.transcript.items).get(toolCallId) : undefined;
const callIndexCache = new WeakMap<object, ReadonlySet<string>>();
function callIndexOf(items: Readonly<Record<string, ItemRecord>>): ReadonlySet<string> {
  const known = callIndexCache.get(items);
  if (known !== undefined) return known;
  const ids = new Set<string>();
  for (const item of Object.values(items)) {
    if (item.kind !== "assistant") continue;
    for (const block of item.message.content) if (block.type === "toolCall") ids.add(block.id);
  }
  callIndexCache.set(items, ids);
  return ids;
}
/** 이 호출 id를 가진 호출 블록이 확정 기록에 있는가 */
export const selectHasToolCall = (s: EngineMirror, toolCallId: string): boolean =>
  s.transcript?.status === "ready" && callIndexOf(s.transcript.items).has(toolCallId);
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
/** 엔진이 열어 본문까지 받은 대화. 다시 켠 뒤 고른 채로만 남은 대화와 열리는 중인 대화는 아니다 */
export const selectReadyThreadId = (s: EngineMirror): ThreadId | null =>
  s.transcript?.status === "ready" ? s.transcript.threadId : null;
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
/** thread에서 답을 기다리는 승인 수. 거울 목록과 요약 수 중 큰 쪽이다(resume-band와 같은 기준) */
export const selectThreadApprovals = (s: EngineMirror, id: ThreadId): number => {
  let listed = 0;
  for (const approvalId of s.approvals.ids) {
    if (s.approvals.byId[approvalId]?.threadId === id) listed += 1;
  }
  return Math.max(listed, s.threads.byId[id]?.pendingApprovals ?? 0);
};
/** 이 도구 호출이 승인을 기다리는 중인지(승인 요청의 origin.toolCallId 짝) */
export const selectToolCallAwaitingApproval = (s: EngineMirror, toolCallId: string): boolean => {
  for (const approvalId of s.approvals.ids) {
    if (s.approvals.byId[approvalId]?.request.origin.toolCallId === toolCallId) return true;
  }
  return false;
};
/** 이 thread에 진행 중인 turn이 있는지. 입력창이 중단 버튼을 보일지 정한다 */
export const selectThreadRunning = (s: EngineMirror, id: ThreadId): boolean =>
  s.threads.byId[id]?.status === "running";
export const selectOpenThread = (s: EngineMirror): ThreadSummary | undefined => {
  const id = selectOpenThreadId(s);
  return id === null ? undefined : s.threads.byId[id];
};
/** 열린 대화가 실행 중인가. 열린 대화가 없으면 아니다 */
export const selectOpenThreadRunning = (s: EngineMirror): boolean => {
  const id = selectOpenThreadId(s);
  return id !== null && selectThreadRunning(s, id);
};
export const selectTurnFailure = (s: EngineMirror, id: ThreadId | null): string | null =>
  id === null ? null : (s.turnFailures[id] ?? null);
/**
 * 응답 없이 끝난 사용자 말 item. 열린 대화의 마지막으로 보이는 item이 사용자 말이고(내용 없이 실패한 어시스턴트 item은 건너뛴다), 대화가 쉬는 중이며, 이어서 실행할 표식과 진행 중 item이 없을 때다.
 * 실패 문장은 이 연결에서만 거울에 있으므로 다시 켠 뒤에도 같은 표식이 서도록 기록의 모양으로 정한다(화면 표식만, 모델 문맥은 엔진 몫).
 */
export const selectUnsentUserItemId = (s: EngineMirror): ItemId | null => {
  const transcript = s.transcript;
  if (transcript?.status !== "ready") return null;
  const thread = s.threads.byId[transcript.threadId];
  if (thread === undefined || thread.status !== "idle" || thread.resumable !== null) return null;
  // 화면에 그리지 않는 item(시스템, display가 거짓인 확장, 내용 없이 실패한 어시스턴트)은 건너뛰고 그 앞의 item을 본다(item-view의 같은 규칙)
  for (let i = transcript.itemIds.length - 1; i >= 0; i -= 1) {
    const id = transcript.itemIds[i];
    const item = id === undefined ? undefined : transcript.items[id];
    if (id === undefined || item === undefined) return null;
    const hidden =
      item.kind === "system" ||
      (item.kind === "custom" && !item.message.display) ||
      (item.kind === "assistant" &&
        (item.status === "failed" || item.status === "interrupted") &&
        item.message.content.length === 0);
    if (hidden) continue;
    return item.kind === "user" ? id : null;
  }
  return null;
};
/** 열린 대화의 마지막 사용자 메시지 글. 다시 보내기가 쓴다. 첨부는 싣지 않는다. 글이 없으면 null이다 */
export const selectLastUserText = (s: EngineMirror): string | null => {
  const transcript = s.transcript;
  if (transcript?.status !== "ready") return null;
  for (let i = transcript.itemIds.length - 1; i >= 0; i -= 1) {
    const id = transcript.itemIds[i];
    const item = id === undefined ? undefined : transcript.items[id];
    if (item?.kind !== "user") continue;
    const content = item.message.content;
    if (typeof content === "string") return content === "" ? null : content;
    const parts: string[] = [];
    for (const block of content) {
      if ("text" in block && typeof block.text === "string") parts.push(block.text);
    }
    const text = parts.join("\n");
    return text === "" ? null : text;
  }
  return null;
};
/** 대화별 실패로 끝난 마지막 turn의 문장. 거울의 기록 객체를 그대로 준다 */
export const selectTurnFailures = (s: EngineMirror): Readonly<Record<string, string>> =>
  s.turnFailures;
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
