import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { TapePlayer } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 정해진 답을 차례로 내면서, 모델이 받은 요청 본문을 모으는 테이프 모델. 작은 컨텍스트 창을 줄 수 있고, 요청 하나의 응답을 풀어 줄 때까지
// 붙잡아 둘 수 있다(요약 호출이 도는 중에 다른 요청을 보내는 시험). 대화 turn과 요약 호출이 같은 큐(`main`)에서 차례로 답을 꺼낸다.

interface RecordingModels {
  readonly buildModels: NonNullable<AssembleOptions["buildModels"]>;
  /** 요청마다 모델이 받은 메시지 열을 JSON 텍스트로 한 줄씩. 요약 호출도 한 요청이다 */
  requestTexts(): readonly string[];
  /** `holdRequest`번째(0부터) 요청이 모델에 닿으면 풀린다. `holdRequest`가 없으면 영영 풀리지 않는다 */
  readonly reached: Promise<void>;
  /** 붙잡아 둔 요청의 응답을 내보낸다. 붙잡지 않았으면 아무 일도 없다 */
  release(): void;
}

interface RecordingOptions {
  readonly contextWindow: number;
  /** 이 번호(0부터)의 요청은 `release()`가 불릴 때까지 응답을 내지 않는다 */
  readonly holdRequest?: number;
}

export function recordingModels(
  id: string,
  answers: readonly string[],
  options: RecordingOptions,
): RecordingModels {
  const inner = tapePlayer(
    tape(
      id,
      answers.map((answer, index) => ({
        role: "main" as const,
        label: `answer ${String(index + 1)}`,
        response: {
          type: "message" as const,
          content: [t.text(answer)],
          stopReason: "stop" as const,
        },
      })),
    ),
    { clock: realTapeClock() },
  );
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const counter = { requests: 0 };
  const player: TapePlayer = {
    stream(request) {
      const index = counter.requests;
      counter.requests += 1;
      const events = inner.stream(request);
      if (index !== options.holdRequest) return events;
      reached.resolve();
      return {
        rawEvents: events.rawEvents,
        async *[Symbol.asyncIterator]() {
          await released.promise;
          yield* events;
        },
      };
    },
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => {
      inner.assertExhausted();
    },
  };
  const provider = tapeProvider(player, {
    models: [{ id: "tape-1", contextWindow: options.contextWindow, maxTokens: 1024 }],
  });
  return {
    buildModels: tapeBuildModels(provider),
    requestTexts: () =>
      provider.calls().map((call) => {
        const payload: unknown = call.payload;
        if (typeof payload !== "object" || payload === null || !("messages" in payload)) return "";
        return JSON.stringify(payload.messages);
      }),
    reached: reached.promise,
    release: () => {
      released.resolve();
    },
  };
}
