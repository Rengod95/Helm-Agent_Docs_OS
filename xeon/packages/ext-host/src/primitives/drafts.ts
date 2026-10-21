import type { IdFactory, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventDraft, EventKind } from "@xeon/contracts/records";

export interface DraftInput {
  readonly threadId: ThreadId;
  readonly kind: EventKind;
  readonly payload: unknown;
  readonly version?: number;
  readonly turnId?: TurnId | undefined;
  readonly stepId?: StepId | undefined;
}

/** 내구 이벤트 초안을 만든다. id는 IdFactory로 미리 발급한다. seq, recordedAt, parentId는 저장소가 채운다 */
export function makeDraft(ids: IdFactory, input: DraftInput): DurableEventDraft {
  return {
    id: ids.next("evt"),
    kind: input.kind,
    version: input.version ?? 1,
    threadId: input.threadId,
    turnId: input.turnId ?? null,
    stepId: input.stepId ?? null,
    causationId: null,
    correlationId: null,
    payload: input.payload,
    durable: true,
  };
}
