import { t, tape } from "@fresnel/core-models/testing";
import type { JsonObject } from "@fresnel/contracts/conversation";

// 검토 되돌림 이어하기 시험(review-restart.int.test.ts)과 그 자식 호스트(review-crash-host.ts)가 같이 쓰는 모델 대본.
// 모델이 a.txt의 한 줄을 고치고(edit) 리뷰를 연다(review_request). 그 뒤 두 번 말로 끝낸다.

export const REVIEW_ORIGINAL: string =
  ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";
export const REVIEW_EDITED: string = REVIEW_ORIGINAL.replace("four\n", "FOUR\n");

function step(label: string, name: string, args: JsonObject, id: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.toolCall(name, args, id)],
      stopReason: "toolUse" as const,
    },
  };
}

function say(label: string) {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content: [t.text("done.")], stopReason: "stop" as const },
  };
}

export function reviewTape(id: string): ReturnType<typeof tape> {
  return tape(id, [
    step(
      "edit",
      "edit",
      { path: "a.txt", edits: [{ oldText: "four\n", newText: "FOUR\n" }] },
      "call_1",
    ),
    step("open review", "review_request", {}, "call_2"),
    say("first done"),
    say("follow-up done"),
  ]);
}

/** 재시작한 호스트의 대본. 제출이 에이전트에 전달하는 입력에 말로만 답한다(도구는 부르지 않는다) */
export function reviewResumeTape(id: string): ReturnType<typeof tape> {
  return tape(id, [say("follow-up done"), say("follow-up done again")]);
}
