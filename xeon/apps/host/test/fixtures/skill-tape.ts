import type { JsonObject } from "@fresnel/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 스킬을 읽는 모델 테이프: skill_view를 한 번 부르고 끝낸다.

export function skillViewingModels(
  id: string,
  skill: string,
): NonNullable<AssembleOptions["buildModels"]> {
  return toolCallingModels(id, "skill_view", { name: skill });
}

/** 모델이 도구 하나를 한 번 부르고 끝내는 테이프 */
export function toolCallingModels(
  id: string,
  toolName: string,
  args: JsonObject,
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          {
            role: "main",
            label: "calls the tool",
            response: {
              type: "message",
              content: [t.toolCall(toolName, args, "call_1")],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "answers after the tool",
            response: { type: "message", content: [t.text("read it.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
