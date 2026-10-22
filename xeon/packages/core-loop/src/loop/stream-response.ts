// Derived from pi-agent-core 1.3.0 agent-loop.ts streamAssistantResponse (MIT, Copyright (c) 2025 Mario Zechner). See LICENSE.pi.
import type { AssistantMessage, StreamFn } from "@xeon/contracts/conversation";
import { abortedStream } from "../streams.ts";
import type { RequestInput } from "./prepare-request.ts";
import { emitMessageStart, emitMessageUpdate } from "./sink.ts";
import { currentStep, failureText, overrides, type TurnRun } from "./turn-run.ts";

// L1.loop.spec §3.2 단계 3 `streamResponse`. `modelCalls` 슬롯을 잡고 streamFn을 불러 부분 메시지를 이벤트로 낸다.
// XEON-PATCH: no-context-array — 원본과 달리 컨텍스트 배열에 push하지 않는다. 최종 메시지만 돌려주고, 기록은 commitResponse가 한다.
// XEON-PATCH: no-api-key — getApiKey·apiKey 처리는 없다. core-models가 키를 임대한다.
// XEON-PATCH: model-slot — streamFn을 `modelCalls` 슬롯으로 감싼다(L1.tasks.spec §4.5 C1).

/** `xeon.models`의 streamFn을 `modelCalls` 슬롯으로 감싼 것(L1.tasks.spec §4.5 C1). 전역 기본 streamFn은 없다 */
function modelStreamFn(run: TurnRun): StreamFn {
  const { ctx, scope, threadId, turnId } = run;
  return async (model, transcript, options) => {
    const step = run.mapper.snapshot();
    const inner = ctx.models.streamFn({
      threadId,
      turnId,
      stepId: step.stepId,
      role: "main",
      ...overrides(run),
      signal: scope.signal,
    });
    let slot;
    try {
      slot = await ctx.tasks.limiter("modelCalls").acquire(scope);
    } catch (error) {
      // 슬롯을 기다리다 취소됐다. 요청은 나가지 않고 aborted 응답으로 정착한다
      ctx.logger.debug("loop.model_slot_cancelled", {
        threadId,
        turnId,
        reason: failureText(error),
      });
      return abortedStream(model.api, model.provider, model.id, ctx.clock.now());
    }
    let stream;
    try {
      stream = await inner(model, transcript, options);
    } catch (error) {
      slot.release();
      throw error;
    }
    const release = (): void => {
      slot.release();
    };
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of stream) yield event;
        } finally {
          release();
        }
      },
      async result() {
        try {
          return await stream.result();
        } finally {
          release();
        }
      },
    };
  };
}

/** 응답 하나를 스트리밍한다. 시작·갱신 이벤트를 내고 최종 메시지를 돌려준다. `message_end`는 commitResponse가 낸다 */
export async function streamResponse(
  run: TurnRun,
  request: RequestInput,
): Promise<AssistantMessage> {
  const { ctx, scope } = run;
  currentStep(run);
  const llmMessages = ctx.context.convertToLlm(request.messages);
  const streamFn = modelStreamFn(run);
  const response = await streamFn(
    request.model,
    { messages: [...llmMessages] },
    {
      signal: scope.signal,
      ...(request.thinkingLevel === "off" ? {} : { reasoning: request.thinkingLevel }),
    },
  );
  // 요청한 추론 수준을 어느 streamFn이 답했든 최종 메시지에 남긴다
  const result = async (): Promise<AssistantMessage> => ({
    ...(await response.result()),
    thinkingLevel: request.thinkingLevel,
  });

  let partial: AssistantMessage | null = null;
  let started = false;
  for await (const event of response) {
    switch (event.type) {
      case "start":
        partial = event.partial;
        started = true;
        await emitMessageStart(run, { ...partial });
        break;
      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        if (partial !== null) {
          partial = event.partial;
          await emitMessageUpdate(run, { ...partial }, event);
        }
        break;
      case "done":
      case "error": {
        const final = await result();
        if (!started) await emitMessageStart(run, { ...final });
        return final;
      }
    }
  }
  const final = await result();
  if (!started) await emitMessageStart(run, { ...final });
  return final;
}
