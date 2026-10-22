// 결과 불명 효과의 판정과 합성 결과 커밋 초안(L1.persistence.spec §3.7, §4.7).
// decideOpenEffect는 순수 함수다. F decideEffectRecovery에 재실행 상한을 더한다.
import type { Clock } from "@xeon/contracts";
import type { EffectId, IdFactory, ItemId, ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  decideEffectRecovery,
  MAX_REPLAY_ATTEMPTS,
  NOT_STARTED_TEXT,
  OUTCOME_UNKNOWN_TEXT,
  type CommitPlan,
  type CommitRequest,
  type DurableEventEnvelope,
  type EffectExec,
  type EffectIntent,
  type EffectRecovery,
  type EffectResult,
  type ReplayPolicy,
  type StampedDraft,
} from "@xeon/contracts/records";
import { sha256Hex } from "./hash.ts";
import type { ProducerRegistry } from "./producers.ts";

export interface OpenEffectInput {
  readonly intent: EffectIntent;
  readonly lastExec: EffectExec | null;
  readonly result: EffectResult | null;
  /** ToolService.meta(name)?.replay를 toReplayPolicy로 바꾼 값. 도구가 없으면 null */
  readonly currentReplay: ReplayPolicy | null;
  /** effect.exec 건수. 첫 실행 1, 재실행마다 1 증가 */
  readonly execCount: number;
}

/**
 * F decideEffectRecovery에 재실행 상한을 더한다. 재실행 수 = max(0, execCount - 1)이고, 상한(MAX_REPLAY_ATTEMPTS)에 이르면
 * rerun 판정을 outcome_unknown 합성으로 바꾼다. result.resultItemId는 null로 나오고 커밋 때 채운다
 */
export function decideOpenEffect(input: OpenEffectInput): EffectRecovery {
  const base = decideEffectRecovery({
    intent: input.intent,
    exec: input.lastExec,
    result: input.result,
    currentReplay: input.currentReplay,
  });
  if (base.action === "rerun" && Math.max(0, input.execCount - 1) >= MAX_REPLAY_ATTEMPTS) {
    return {
      action: "synthesize",
      code: "outcome_unknown",
      result: synthesizedResult(input.intent.effectId, "interrupted"),
      content: OUTCOME_UNKNOWN_TEXT,
    };
  }
  return base;
}

function synthesizedResult(effectId: EffectId, status: "interrupted" | "abandoned"): EffectResult {
  return {
    effectId,
    status,
    resultItemId: null,
    output: null,
    blobRef: null,
    durationMs: null,
    synthesized: true,
  };
}

/** 취소 의도가 있는 turn의 열린 효과는 rerun이어도 다시 실행하지 않고 합성으로 닫는다(§4.8.1 5단계) */
export function closeInsteadOfRerun(decision: EffectRecovery, hasExec: boolean): EffectRecovery {
  if (decision.action !== "rerun") return decision;
  const code = hasExec ? "outcome_unknown" : "not_started";
  return {
    action: "synthesize",
    code,
    result: synthesizedResult(decision.intent.effectId, hasExec ? "interrupted" : "abandoned"),
    content: hasExec ? OUTCOME_UNKNOWN_TEXT : NOT_STARTED_TEXT,
  };
}

export interface SynthesisInput {
  readonly threadId: ThreadId;
  readonly intentEvent: DurableEventEnvelope;
  readonly intent: EffectIntent;
  readonly code: "not_started" | "outcome_unknown";
  readonly result: EffectResult;
  readonly content: string;
}

export interface SynthesisDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly producers: ProducerRegistry;
}

/**
 * 합성 결과 커밋 요청. effect.result{synthesized: true}와 isError toolResult item.recorded를 한 커밋으로 쓴다.
 * 커밋 키는 처음 결과와 같은 tool:<commitKeyPart(toolCallId)>:result라 효과마다 종결 기록은 하나다(eng.transactions.design §5.1)
 */
export function synthesisRequest(deps: SynthesisDeps, input: SynthesisInput): CommitRequest {
  const { intent, intentEvent, threadId } = input;
  return {
    threadId,
    // 정상 결과와 같은 키여야 효과마다 종결 기록이 하나다. toolCallId 변환은 commitKeyPart 하나다(U-13)
    requestId: `tool:${commitKeyPart(intent.toolCallId, sha256Hex)}:result`,
    // 생성 id와 시각은 넣지 않는다. 같은 효과의 같은 합성은 같은 지문이다
    fingerprintSource: { toolCallId: intent.toolCallId, synthesized: input.code },
    build(view): CommitPlan {
      const settled = view.effect(intent.effectId);
      if (settled !== undefined && settled.result !== null) {
        return { kind: "reject", code: "already_settled", detail: intent.toolCallId };
      }
      const itemId: ItemId = deps.ids.next("itm");
      const scope = { turnId: intentEvent.turnId, stepId: intentEvent.stepId, threadId };
      const resultDraft: StampedDraft = deps.producers.recoveryDraft({
        ...scope,
        id: deps.ids.next("evt"),
        kind: "effect.result",
        causationId: intentEvent.id,
        correlationId: intent.effectId,
        payload: { ...input.result, resultItemId: itemId },
      });
      const itemDraft: StampedDraft = deps.producers.recoveryDraft({
        ...scope,
        id: deps.ids.next("evt"),
        kind: "item.recorded",
        causationId: intentEvent.id,
        correlationId: intent.effectId,
        payload: {
          item: {
            itemId,
            status: "interrupted",
            kind: "toolResult",
            message: {
              role: "toolResult",
              toolCallId: intent.toolCallId,
              toolName: intent.toolName,
              content: [{ type: "text", text: input.content }],
              isError: true,
              timestamp: deps.clock.now(),
            },
            effectId: intent.effectId,
          },
        },
      });
      return { kind: "append", drafts: [resultDraft, itemDraft], checkpoint: null };
    },
  };
}
