import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";

// L1.tasks.spec §4.8 3번. 재개 때 열린 turn이 취소 의도를 소유 사슬에서 얻는지 판정한다.

/** 자식 thread가 어느 부모 turn 아래에서 열렸는지. 투영 p_agents의 한 행이다 */
export interface OwnerLink {
  readonly parentThreadId: ThreadId;
  /** 소유한 부모 turn. scope·drive 소유처럼 turn이 없으면 null이고, 사슬은 거기서 끝난다 */
  readonly ownerTurnId: TurnId | null;
  /** 백그라운드 위임이면 참. 이 경계를 넘어 부모의 취소가 내려오지 않는다 */
  readonly background: boolean;
}

/** 소유 사슬을 따라 읽는 두 질의. 호스트가 SessionService의 투영으로 만든다 */
export interface OwnerChainReader {
  /** 그 turn에 `turn.abort_requested`가 있으면 참. turn 기록이 없으면 거짓 */
  turnAbortRequested(threadId: ThreadId, turnId: TurnId): boolean;
  /** 자식 thread의 소유 연결. 최상위 thread이거나 연결 기록이 없으면 null */
  ownerOf(threadId: ThreadId): OwnerLink | null;
}

/**
 * 열린 turn이 재개하지 않고 닫혀야 하는지 판정한다.
 * 자기 turn에 취소 의도가 있으면 참이다. 의도가 없어도 소유 사슬(turn → 부모 tool → 부모 turn …)의
 * 어느 부모 turn에 의도가 있고 그 사이에 백그라운드 경계가 없으면 참이다.
 */
export function isCancelledByOwner(
  reader: OwnerChainReader,
  threadId: ThreadId,
  turnId: TurnId,
): boolean {
  if (reader.turnAbortRequested(threadId, turnId)) return true;
  const visited = new Set<ThreadId>([threadId]);
  let link = reader.ownerOf(threadId);
  while (link !== null && !link.background && link.ownerTurnId !== null) {
    if (reader.turnAbortRequested(link.parentThreadId, link.ownerTurnId)) return true;
    // 소유 연결은 생성 뒤 바뀌지 않아 순환이 없다. 깨진 기록이 무한 순회를 만들지 않도록 막는다
    if (visited.has(link.parentThreadId)) return false;
    visited.add(link.parentThreadId);
    link = reader.ownerOf(link.parentThreadId);
  }
  return false;
}
