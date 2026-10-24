import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 승인이 필요한 도구 호출(bash)을 내는 모델 테이프. 승인 응답 뒤 도구 결과를 보고 한 마디로 끝낸다.

export const APPROVAL_COMMAND = "echo approved-by-user";

export function approvalModels(id: string): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          {
            role: "main",
            label: "asks to run a command",
            response: {
              type: "message",
              content: [t.toolCall("bash", { command: APPROVAL_COMMAND }, "call_1")],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "answers after the tool result",
            response: { type: "message", content: [t.text("finished.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
