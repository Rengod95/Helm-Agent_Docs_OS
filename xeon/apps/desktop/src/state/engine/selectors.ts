// src/state/engine/selectors.ts
import type { EventId, ItemId, ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import type { ThreadSummary } from "@xeon/contracts/wire";
import type { EngineState } from "../../transport/ipc.ts";
import type { EngineMirror, Link, PendingApproval, StreamingItem } from "./state.ts";

// 빈 값은 모듈 상수다. 선택자가 [] 리터럴을 돌려주면 매번 새 참조라 재렌더가 끝나지 않는다
const NO_ITEMS: readonly ItemId[] = Object.freeze([]);

export const selectThreadIds = (s: EngineMirror): readonly ThreadId[] => s.threads.ids;
export const selectThread = (s: EngineMirror, id: ThreadId): ThreadSummary | undefined =>
  s.threads.byId[id];
/** 목록 순서(최근 활동 먼저)로 본 서로 다른 작업 폴더. 새 대화의 폴더 후보다. 배열을 새로 만들므로 훅에서 useShallow로 감싼다 */
export const selectRecentWorkspaces = (s: EngineMirror, limit: number): readonly string[] => {
  const seen = new Set<string>();
  for (const id of s.threads.ids) {
    const workspace = s.threads.byId[id]?.workspace;
    if (workspace !== null && workspace !== undefined) seen.add(workspace);
    if (seen.size >= limit) break;
  }
  return [...seen];
};
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
export const selectApprovalCount = (s: EngineMirror): number => s.approvals.ids.length;
