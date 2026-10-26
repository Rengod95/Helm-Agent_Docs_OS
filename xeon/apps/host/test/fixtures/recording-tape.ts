import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 정해진 답을 차례로 내면서, 모델이 받은 요청 본문을 모으는 테이프 모델. 작은 컨텍스트 창을 줄 수 있다.
// 대화 turn과 요약 호출이 같은 큐(`main`)에서 차례로 답을 꺼낸다.

export interface RecordingModels {
  readonly buildModels: NonNullable<AssembleOptions["buildModels"]>;
  /** 요청마다 모델이 받은 메시지 열을 JSON 텍스트로 한 줄씩. 요약 호출도 한 요청이다 */
  requestTexts(): readonly string[];
}

export function recordingModels(
  id: string,
  answers: readonly string[],
  options: { readonly contextWindow: number },
): RecordingModels {
  const provider = tapeProvider(
    tapePlayer(
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
    ),
    { models: [{ id: "tape-1", contextWindow: options.contextWindow, maxTokens: 1024 }] },
  );
  return {
    buildModels: tapeBuildModels(provider),
    requestTexts: () =>
      provider.calls().map((call) => {
        const payload: unknown = call.payload;
        if (typeof payload !== "object" || payload === null || !("messages" in payload)) return "";
        return JSON.stringify(payload.messages);
      }),
  };
}
