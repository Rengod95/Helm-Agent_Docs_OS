import type { IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  STEP_CHECKPOINT_SCHEMA_VERSION,
  type DurableEventDraft,
  type PendingToolCall,
  type StepCheckpoint,
} from "@xeon/contracts/records";
import type { CallerId, ToolRunContext } from "@xeon/contracts/services";
import type { FakeSession } from "./fake-session.ts";

export interface FakeRunOptions {
  readonly session: FakeSession;
  readonly ids: IdFactory;
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
  readonly interactive?: boolean;
  readonly caller?: CallerId;
  readonly signal?: AbortSignal;
}

/** 한 단계의 ToolRunContext 대역. 루프 생산자(core.loop)로 초안을 만들고, 대기 체크포인트는 실제 루프처럼 낙인 없는 초안으로 낸다 */
export function fakeRunContext(options: FakeRunOptions): ToolRunContext {
  const { session, ids } = options;
  const threadId = options.threadId ?? ids.next("thr");
  const turnId = options.turnId ?? ids.next("trn");
  const stepId = ids.next("stp");
  const loop = session.producer("core.loop");
  return {
    threadId,
    turnId,
    stepId,
    caller: options.caller ?? "main",
    depth: 0,
    interactive: options.interactive ?? true,
    surfaceThreadId: threadId,
    signal: options.signal ?? new AbortController().signal,
    drafts: {
      toolResultItem: (input) =>
        loop.draft({
          id: ids.next("evt"),
          kind: "item.recorded",
          threadId,
          turnId,
          stepId,
          causationId: null,
          correlationId: null,
          payload: {
            item: {
              itemId: input.itemId,
              status: "completed",
              kind: "toolResult",
              message: input.message,
              effectId: input.effectId,
            },
          },
        }),
      // 실제 루프처럼 낙인 없는 checkpoint.step 초안(DurableEventDraft)을 낸다. 내용은 완성된 StepCheckpoint다
      waitingCheckpoint: (pending: readonly PendingToolCall[]): DurableEventDraft => {
        const checkpoint: StepCheckpoint = {
          checkpointId: ids.next("ckp"),
          schemaVersion: STEP_CHECKPOINT_SCHEMA_VERSION,
          threadId,
          turnId,
          stepId,
          stepIndex: 0,
          leafEventId: ids.next("evt"),
          next: "await_input",
          pendingToolCalls: [...pending],
          inputCursor: { consumedSeq: 0 },
          model: { provider: "test", modelId: "tape", thinkingLevel: "off" },
          leaseRefs: [],
          scopeRef: null,
        };
        return {
          id: ids.next("evt"),
          kind: "checkpoint.step",
          version: 1,
          durable: true,
          threadId,
          turnId,
          stepId,
          causationId: null,
          correlationId: null,
          payload: checkpoint,
        };
      },
    },
  };
}
