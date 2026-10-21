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
import { headSeqOf } from "./events.ts";
import { toEventId } from "./ids.ts";
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

/**
 * build가 읽는 트랜잭션 안 보기. build 호출 시점에 커밋된 상태를 투영 테이블에서 읽는다.
 * M2 투영(p_agents, p_scopes)이 아직 없어 agentByRequestId, scopeLeaseEpoch, scopeStateRev는 "없음"(undefined, 0)을 돌려준다.
 * 해당 kind를 커밋하는 M2 생산자가 오기 전에는 호출되지 않는다. 승인(p_approvals)은 M1 core-tools가 커밋하므로 투영한다.
 */
export function createTxView(tx: SqlTx, threadId: ThreadId): TxView {
  const thread = readThread(tx, threadId);
  return {
    threadId,
    headSeq: headSeqOf(tx),
    leaf:
      thread === undefined || thread.leafEventId === null ? null : toEventId(thread.leafEventId),
    threadStatus: thread?.status ?? "absent",
    turn(turnId: TurnId): TurnView | undefined {
      return readTurn(tx, turnId);
    },
    turnAbortRequested(turnId: TurnId): boolean {
      return readTurn(tx, turnId)?.abortRequested ?? false;
    },
    effect(effectId: EffectId): EffectView | undefined {
      return readEffect(tx, effectId);
    },
    effectByToolCall(target: ThreadId, toolCallId: string): EffectView | undefined {
      return readEffectByCall(tx, target, toolCallId);
    },
    turnByRequestId(
      target: ThreadId,
      scopeId: string | null,
      requestId: string,
    ): TurnView | undefined {
      return readTurnByRequest(tx, target, scopeId, requestId);
    },
    scopeLeaseEpoch(): number {
      return 0;
    },
    inputByRequestId(
      target: ThreadId,
      sourceKey: string,
      requestId: string,
    ): InputView | undefined {
      return readInputByRequest(tx, target, sourceKey, requestId);
    },
    queuedInputs(target: ThreadId): readonly InputView[] {
      return readQueuedInputs(tx, target);
    },
    approval(approvalId): ApprovalView | undefined {
      return readApproval(tx, approvalId);
    },
    agentByRequestId(): AgentView | undefined {
      return undefined;
    },
    scopeStateRev(): number {
      return 0;
    },
    lastCheckpoint(target: ThreadId): StepCheckpoint | null {
      return readCheckpoint(tx, target);
    },
  };
}
