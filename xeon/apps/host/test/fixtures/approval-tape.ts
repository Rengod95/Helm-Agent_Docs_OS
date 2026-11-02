import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 승인이 필요한 도구 호출(bash)을 내는 모델 테이프. 승인 응답 뒤 도구 결과를 보고 한 마디로 끝낸다.

export const APPROVAL_COMMAND = "echo approved-by-user";

/** 도구 호출 하나를 내는 차례 */
function askTurn(callId: string, command: string) {
  return {
    role: "main" as const,
    label: `asks to run ${command}`,
    response: {
      type: "message" as const,
      content: [t.toolCall("bash", { command }, callId)],
      stopReason: "toolUse" as const,
    },
  };
}

const ANSWER_TURN = {
  role: "main" as const,
  label: "answers after the tool result",
  response: {
    type: "message" as const,
    content: [t.text("finished.")],
    stopReason: "stop" as const,
  },
};

/**
 * 대화 두 개가 각각 승인을 요청하는 테이프(W-01). 모델 역할 `main`의 차례는 호출 순서대로 쓰이므로 첫째·둘째 호출이 승인을 내고,
 * 셋째·넷째가 각 도구 결과 뒤의 답이다. 시험은 첫 대화의 승인을 기다린 뒤 둘째 대화를 시작해 차례를 정한다.
 */
export function approvalModelsForTwoThreads(
  id: string,
): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          askTurn("call_1", APPROVAL_COMMAND),
          askTurn("call_2", "echo second-approval"),
          ANSWER_TURN,
          ANSWER_TURN,
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

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
