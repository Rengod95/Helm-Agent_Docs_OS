import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 웹 페이지를 읽는 모델 테이프: web_fetch를 한 번 부르고 결과를 본 뒤 끝낸다.

export function fetchingModels(
  id: string,
  url: string,
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          {
            role: "main",
            label: "reads a page",
            response: {
              type: "message",
              content: [t.toolCall("web_fetch", { url }, "call_1")],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "answers after the page",
            response: { type: "message", content: [t.text("read it.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
