import { describe, expect, test } from "bun:test";
import { defaultAskAnswer, type AskQuestion } from "@xeon/contracts/capabilities";
import { createAskService } from "../src/ask/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { realApprovals } from "./support/real-approvals.ts";

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};
const MODE: AskQuestion = {
  id: "mode",
  question: "방식은?",
  options: [
    { id: "fast", label: "빠르게", recommended: true },
    { id: "safe", label: "안전하게" },
  ],
};
const FREE: AskQuestion = { id: "free", question: "자유" };

describe("선택지 추천과 시간 제한 기본값", () => {
  test("모든 질문에 추천이 있으면 defaultAskAnswer가 답을 만들고 하나라도 없으면 null이다", () => {
    expect(defaultAskAnswer([SCOPE, MODE])).toEqual({
      answers: [
        { questionId: "scope", selected: ["small"], text: null },
        { questionId: "mode", selected: ["fast"], text: null },
      ],
    });
    expect(defaultAskAnswer([SCOPE, FREE])).toBeNull();
    const unrecommended: AskQuestion = {
      id: "plain",
      question: "추천 없음",
      options: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
    };
    expect(defaultAskAnswer([unrecommended])).toBeNull();
  });

  test("입력 timeoutSec이 없으면 설정값을 쓰고 0이면 만료가 걸리지 않는다", async () => {
    const thread = newThread();
    // 설정 10초
    const withSetting = harness({
      approvals: await realApprovals(),
      layers: [{ scope: "user", values: new Map([["l2.dialog.ask.timeoutSec", 10]]) }],
    });
    const asked = createAskService(withSetting.deps);
    await asked.api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: "r1" }));
    expect(withSetting.timers.pending()).toBe(1);

    // 입력이 설정을 이긴다: 0은 제한 없음
    const zero = createAskService(withSetting.deps);
    await zero.api.ask(
      { questions: [MODE], timeoutSec: 0 },
      callOptions(thread, { requestId: "r2" }),
    );
    expect(withSetting.timers.pending()).toBe(1);

    // 설정 기본값 0
    const plain = harness({ approvals: await realApprovals() });
    const none = createAskService(plain.deps);
    await none.api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: "r3" }));
    expect(plain.timers.pending()).toBe(0);
    asked.dispose();
    zero.dispose();
    none.dispose();
  });
});
