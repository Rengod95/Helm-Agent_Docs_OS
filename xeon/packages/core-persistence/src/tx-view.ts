import type { Result } from "@xeon/contracts";
import type { EffectId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  AgentView,
  ApprovalView,
  EffectView,
  InputView,
  SqlTx,
  StepCheckpoint,
  TurnView,
  TxView,
} from "@xeon/contracts/records";
import { readCheckpoint } from "./checkpoint.ts";
import { activeLeaseEpoch, activeStateOf } from "./ext-queries.ts";
import { headSeqOf } from "./events.ts";
import type { RowFault } from "./rows.ts";
import {
  readApproval,
  readEffect,
  readEffectByCall,
  readInputByRequest,
  readQueuedInputs,
  readThread,
  readTurn,
  readTurnByRequest,
} from "./views.ts";

/** 읽다가 행이 모양과 다름을 알았을 때 커밋을 중단하는 함수. 트랜잭션을 롤백하고 commit이 row_invalid를 돌려준다 */
export type AbortCommit = (fault: RowFault) => never;

/**
 * build가 읽는 트랜잭션 안 보기. build 호출 시점에 커밋된 상태를 투영 테이블에서 읽는다.
 * scopeStateRev와 scopeLeaseEpoch는 활성 가지(현재 leaf에서 parentId 사슬) 위 이벤트로 계산한다. 버려진 가지의 더 큰 판과 비교하지 않는다
 * (X.primitives.spec §4.6.1 활성 가지 규칙).
 */
export function createTxView(tx: SqlTx, threadId: ThreadId, abort: AbortCommit): TxView {
  // build는 동기·순수 콜백이라 값을 바로 받는다. 손상 행은 읽는 자리에서 커밋을 중단한다(TY-24)
  const unwrap = <T>(read: Result<T, RowFault>): T => (read.ok ? read.value : abort(read.error));
  const thread = unwrap(readThread(tx, threadId));
  return {
    threadId,
    headSeq: unwrap(headSeqOf(tx)),
    leaf: thread?.leafEventId ?? null,
    threadStatus: thread?.status ?? "absent",
    turn(turnId: TurnId): TurnView | undefined {
      return unwrap(readTurn(tx, turnId));
    },
    turnAbortRequested(turnId: TurnId): boolean {
      return unwrap(readTurn(tx, turnId))?.abortRequested ?? false;
    },
    effect(effectId: EffectId): EffectView | undefined {
      return unwrap(readEffect(tx, effectId));
    },
    effectByToolCall(target: ThreadId, toolCallId: string): EffectView | undefined {
      return unwrap(readEffectByCall(tx, target, toolCallId));
    },
    turnByRequestId(
      target: ThreadId,
      scopeId: string | null,
      requestId: string,
    ): TurnView | undefined {
      return unwrap(readTurnByRequest(tx, target, scopeId, requestId));
    },
    scopeLeaseEpoch(target: ThreadId, scopeId: string): number {
      return unwrap(activeLeaseEpoch(tx, target, scopeId));
    },
    inputByRequestId(
      target: ThreadId,
      sourceKey: string,
      requestId: string,
    ): InputView | undefined {
      return unwrap(readInputByRequest(tx, target, sourceKey, requestId));
    },
    queuedInputs(target: ThreadId): readonly InputView[] {
      return unwrap(readQueuedInputs(tx, target));
    },
    approval(approvalId): ApprovalView | undefined {
      return unwrap(readApproval(tx, approvalId));
    },
    agentByRequestId(): AgentView | undefined {
      return undefined;
    },
    scopeStateRev(target: ThreadId, scopeId: string): number {
      return unwrap(activeStateOf(tx, target, scopeId))?.rev ?? 0;
    },
    lastCheckpoint(target: ThreadId): StepCheckpoint | null {
      return unwrap(readCheckpoint(tx, target));
    },
  };
}
