import type { AssistantMessage, AssistantMessageEvent } from "@xeon/contracts/conversation";
import type { AssistantMessageEventStream } from "@xeon/contracts/services";

// L1.models.spec §4.3 10번, §4.4. 스트림을 소비하는 쪽(for await 또는 result())이 구동하는 얇은 관찰 래퍼다.
// 따로 도는 작업을 두지 않으므로 소비자가 없으면 아무 일도 하지 않는다.
// - 종결 이벤트(done, error)의 메시지를 settle로 거쳐 보낸다(마스킹, 분류 같은 후처리).
// - 사용량 기록(onSettled)은 호출당 한 번만 한다. for await 경로와 result() 경로가 같은 최종 메시지를 본다.
// - 종결 이벤트 없이 소비자가 반복을 닫으면 onAbandoned를 부른다(spec §4.4 3번).

export interface ObserveHooks {
  /** 종결 메시지 후처리. 같은 입력에 같은 결과를 낸다 */
  readonly finalize: (message: AssistantMessage) => AssistantMessage;
  /** 최종 메시지가 정해졌을 때 한 번 */
  readonly onSettled: (message: AssistantMessage) => void;
  /** 종결 이벤트 없이 반복이 닫혔을 때 한 번 */
  readonly onAbandoned: () => void;
}

export function observeStream(
  source: AssistantMessageEventStream,
  hooks: ObserveHooks,
): AssistantMessageEventStream {
  let settled: AssistantMessage | null = null;
  let abandoned = false;

  function settle(message: AssistantMessage): AssistantMessage {
    if (settled === null) {
      settled = hooks.finalize(message);
      hooks.onSettled(settled);
    }
    return settled;
  }

  function abandon(): void {
    if (settled === null && !abandoned) {
      abandoned = true;
      hooks.onAbandoned();
    }
  }

  function rewrite(event: AssistantMessageEvent): AssistantMessageEvent {
    if (event.type === "done") return { ...event, message: settle(event.message) };
    if (event.type === "error") return { ...event, error: settle(event.error) };
    return event;
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      const inner = source[Symbol.asyncIterator]();
      return {
        async next() {
          const step = await inner.next();
          if (step.done === true) {
            abandon();
            return step;
          }
          return { done: false, value: rewrite(step.value) };
        },
        async return() {
          abandon();
          await inner.return?.();
          return { done: true, value: undefined };
        },
      };
    },
    async result(): Promise<AssistantMessage> {
      return settle(await source.result());
    },
  };
}
