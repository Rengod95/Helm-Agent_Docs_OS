import type { JsonObject } from "@xeon/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 도구 호출을 차례로 내고 마지막에 한 마디로 끝내는 모델 테이프. 각 호출의 결과는 다음 모델 호출에 보이지만 테이프는 내용을 보지 않는다.

export interface ToolStep {
  readonly name: string;
  readonly args: JsonObject;
}

/** `lead`는 도구 호출 앞의 turn마다 한 마디씩 답하는 텍스트 응답이다(앞선 turn이 테이프를 소비한다) */
export function callingModels(
  id: string,
  steps: readonly ToolStep[],
  final = "done.",
  lead: readonly string[] = [],
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          ...lead.map((text, index) => ({
            role: "main" as const,
            label: `lead ${String(index + 1)}`,
            response: {
              type: "message" as const,
              content: [t.text(text)],
              stopReason: "stop" as const,
            },
          })),
          ...steps.map((step, index) => ({
            role: "main" as const,
            label: `step ${String(index + 1)}: ${step.name}`,
            response: {
              type: "message" as const,
              content: [t.toolCall(step.name, step.args, `call_${String(index + 1)}`)],
              stopReason: "toolUse" as const,
            },
          })),
          {
            role: "main" as const,
            label: "final answer",
            response: {
              type: "message" as const,
              content: [t.text(final)],
              stopReason: "stop" as const,
            },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
