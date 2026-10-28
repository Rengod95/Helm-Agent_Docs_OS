import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 스킬을 읽는 모델 테이프: skill_view를 한 번 부르고 끝낸다.

export function skillViewingModels(
  id: string,
  skill: string,
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          {
            role: "main",
            label: "reads a skill",
            response: {
              type: "message",
              content: [t.toolCall("skill_view", { name: skill }, "call_1")],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "answers after the skill",
            response: { type: "message", content: [t.text("read it.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
