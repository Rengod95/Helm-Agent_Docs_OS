import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  AssistantMessageEvent,
} from "@xeon/contracts/conversation";
import {
  dispatchKey,
  emitNotifications,
  messageIdentity,
  nextPointSeq,
  tapOptions,
  type TurnRun,
} from "./turn-run.ts";

// 이벤트 싱크(adr.0009 §3.2). 매퍼에 이벤트를 먹여 휘발 알림을 내고 tap 지점을 발화한다. 커밋하지 않는다.

/** 매퍼가 만든 알림을 휘발로 낸다. 내구 알림(step.*, turn.completed)은 커밋한 쪽이 다룬다 */
export function emitEvent(run: TurnRun, event: AgentEvent): void {
  emitNotifications(run, run.mapper.map(event));
}

export async function emitMessageStart(run: TurnRun, message: AgentMessage): Promise<void> {
  emitEvent(run, { type: "message_start", message });
  await run.ctx.ext.dispatch(
    "message_start",
    { message: structuredClone(message) },
    tapOptions(
      run,
      dispatchKey(
        run,
        run.mapper.snapshot().stepId,
        `message_start:${messageIdentity(run, message)}`,
      ),
    ),
  );
}

export async function emitMessageUpdate(
  run: TurnRun,
  message: AssistantMessage,
  assistantMessageEvent: AssistantMessageEvent,
): Promise<void> {
  emitEvent(run, { type: "message_update", message, assistantMessageEvent });
  await run.ctx.ext.dispatch(
    "message_update",
    {
      message: structuredClone(message),
      assistantMessageEvent: structuredClone(assistantMessageEvent),
    },
    tapOptions(
      run,
      dispatchKey(run, run.mapper.snapshot().stepId, `message_update:${nextPointSeq(run)}`),
    ),
  );
}
