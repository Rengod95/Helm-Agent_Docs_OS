import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { SessionService } from "@fresnel/contracts/records";
import { isCancelledByOwner, type OwnerChainReader } from "@fresnel/core-tasks";

// L1.tasks.spec §4.8 3번. 재개 때 열린 turn이 소유 사슬에서 취소 의도를 얻었는지 세션 투영으로 판정한다.
// 읽지 못하면(저장소 실패) 취소로 보지 않는다: 닫는 쪽 결정은 되돌릴 수 없고, 열린 채 남으면 다음 재개가 다시 판정한다.

function readerOf(session: SessionService): OwnerChainReader {
  return {
    turnAbortRequested(threadId, turnId) {
      const turn = session.query.turn(threadId, turnId);
      return turn.ok && turn.value !== undefined && turn.value.abortRequested;
    },
    ownerOf(threadId) {
      const link = session.query.agentOfChild(threadId);
      if (!link.ok || link.value === undefined) return null;
      return {
        parentThreadId: link.value.parentThreadId,
        ownerTurnId: link.value.ownerTurnId,
        background: link.value.background,
      };
    },
  };
}

/** `RecoverDeps.cancelledByOwner`와 `LoopDeps.cancelledByOwner`에 넘기는 판정 */
export function cancelledByOwnerOf(
  session: SessionService,
): (threadId: ThreadId, turnId: TurnId) => boolean {
  const reader = readerOf(session);
  return (threadId, turnId) => isCancelledByOwner(reader, threadId, turnId);
}
