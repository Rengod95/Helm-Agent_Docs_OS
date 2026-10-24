import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { CapabilityError, DialogAsk, type AskQuestion } from "@xeon/contracts/capabilities";
import { ApprovalBodyJsonSchema } from "@xeon/contracts/records";
import { createAskService } from "../src/ask/service.ts";
import { callTool } from "./support/adapter.ts";
import { fakeApprovals } from "./support/fake-approvals.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};
const NO_DEFAULT: AskQuestion = {
  id: "name",
  question: "이름은?",
};

const SMALL = { scope: { selected: ["small"] } };
const DAY_MS = 86_400_000;

function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const ask = createAskService(h.deps);
  return { h, ask, api: ask.api };
}

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected a CapabilityError");
}

describe("대기와 출력 대응", () => {
  test("첫 호출은 input_required, 응답 뒤 같은 키 재호출은 answered다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const options = callOptions(thread, { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    expect(first.status).toBe("input_required");
    if (first.status !== "input_required") return;

    expect(await h.approvals.respond(first.approvalId, "answer", SMALL)).toEqual({ applied: true });
    const second = await api.ask({ questions: [SCOPE] }, options);
    expect(second).toEqual({
      status: "answered",
      approvalId: first.approvalId,
      answers: [{ questionId: "scope", selected: ["small"], text: null }],
      defaulted: false,
    });
    // 승인 요청은 하나다
    expect(h.approvals.entries()).toHaveLength(1);
  });

  test("deny는 cancelled(dismissed)다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.approvals.respond(first.approvalId, "deny");
    expect(await api.ask({ questions: [SCOPE] }, options)).toEqual({
      status: "cancelled",
      approvalId: first.approvalId,
      reason: "dismissed",
    });
  });

  test("만료와 추천 답이 있으면 answered(defaulted: true)다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.timers.advance(29_000);
    expect(h.approvals.snapshotOf(first.approvalId)?.state).toBe("pending");
    await h.timers.advance(1_000);
    expect(h.approvals.snapshotOf(first.approvalId)?.state).toBe("resolved");
    expect(await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options)).toEqual({
      status: "answered",
      approvalId: first.approvalId,
      answers: [{ questionId: "scope", selected: ["small"], text: null }],
      defaulted: true,
    });
  });

  test("만료와 추천이 없으면 cancelled(timeout)이다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [NO_DEFAULT], timeoutSec: 5 }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.timers.advance(5_000);
    expect(await api.ask({ questions: [NO_DEFAULT], timeoutSec: 5 }, options)).toEqual({
      status: "cancelled",
      approvalId: first.approvalId,
      reason: "timeout",
    });
  });

  test("사용자가 먼저 답하면 만료는 아무것도 바꾸지 않는다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.approvals.respond(first.approvalId, "answer", { scope: { selected: ["large"] } });
    await h.timers.advance(60_000);
    const settled = await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    expect(settled).toMatchObject({
      status: "answered",
      defaulted: false,
      answers: [{ selected: ["large"] }],
    });
    // 해결을 확인한 호출이 타이머를 거둔다
    expect(h.timers.pending()).toBe(0);
  });
});

describe("무응답 취소", () => {
  test("시간 제한 0에서 시계를 하루 넘겨도 input_required를 유지한다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 0 }, options);
    await h.timers.advance(2 * DAY_MS);
    const later = await api.ask({ questions: [SCOPE], timeoutSec: 0 }, options);
    expect(first.status).toBe("input_required");
    expect(later).toEqual(first);
  });

  test("턴 취소로 승인 요청이 닫히면 재호출은 cancelled(aborted)다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const options = callOptions(thread, { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.approvals.factory.forCall(undefined).cancel(thread, first.approvalId, "turn aborted");
    expect(await api.ask({ questions: [SCOPE] }, options)).toEqual({
      status: "cancelled",
      approvalId: first.approvalId,
      reason: "aborted",
    });
  });
});

describe("같은 레코드 형식", () => {
  test("ask가 만든 승인 요청은 kind question이고 L1 body 스키마를 통과한다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    await api.ask(
      { questions: [SCOPE, NO_DEFAULT] },
      {
        ...callOptions(thread, { requestId: "call-1" }),
        context: {
          threadId: thread,
          toolCallId: "toolcall-1",
          caller: { kind: "model", agent: "main" },
        },
      },
    );
    const [request] = h.approvals.requests;
    expect(request).toMatchObject({ threadId: thread, kind: "question", requestId: "call-1" });
    // L2.work의 계획 승인과 같은 L1 payload 스키마(ApprovalBodyJsonSchema)로 검사한다
    const body = parse(ApprovalBodyJsonSchema, { kind: "question", question: request?.subject });
    expect(body.ok).toBe(true);
    // 호출 문맥은 팩토리에 그대로 간다(origin을 만드는 데 쓴다)
    expect(h.approvals.contexts[0]?.toolCallId).toBe("toolcall-1");
  });

  test("도구 어댑터 경로: ask_user는 wait:false로 불린다", async () => {
    const { h, api } = setup();
    const result = await callTool(
      DialogAsk,
      api,
      "ask_user",
      { questions: [SCOPE] },
      {
        ...callOptions(newThread(), { requestId: "call-1" }),
      },
    );
    expect(result.isError).toBe(false);
    expect(result.content?.structuredContent).toMatchObject({ status: "input_required" });
    expect(h.approvals.entries()).toHaveLength(1);
  });
});

describe("오류", () => {
  test("질문 정의 위반은 ask_invalid_questions이고 승인 요청이 나가지 않는다", async () => {
    const { h, api } = setup();
    const error = await rejection(
      api.ask(
        { questions: [SCOPE, { ...SCOPE }] },
        callOptions(newThread(), { requestId: "call-1" }),
      ),
    );
    expect(error.data.code).toBe("ask_invalid_questions");
    expect(error.data.detail).toMatchObject({ issues: [expect.any(String)] });
    expect(h.approvals.requests).toHaveLength(0);
  });

  test("비대화형 실행은 ask_unavailable_headless다", async () => {
    const { h, api } = setup({ interactive: () => false });
    const error = await rejection(
      api.ask({ questions: [SCOPE] }, callOptions(newThread(), { requestId: "call-1" })),
    );
    expect(error.data.code).toBe("ask_unavailable_headless");
    expect(h.approvals.requests).toHaveLength(0);
  });

  test("스레드 문맥이나 requestId가 없으면 invalid_input이다", async () => {
    const { api } = setup();
    expect((await rejection(api.ask({ questions: [SCOPE] }, { requestId: "x" }))).data.code).toBe(
      "invalid_input",
    );
    expect(
      (await rejection(api.ask({ questions: [SCOPE] }, callOptions(newThread())))).data.code,
    ).toBe("invalid_input");
  });

  test("승인 서비스가 없으면 unavailable이다", async () => {
    const { api } = setup({ approvals: null });
    const error = await rejection(
      api.ask({ questions: [SCOPE] }, callOptions(newThread(), { requestId: "call-1" })),
    );
    expect(error.data).toMatchObject({
      code: "unavailable",
      detail: { reason: "approvals_missing" },
    });
  });

  test("승인 요청 실패는 값으로 오고 공통 코드로 바뀐다", async () => {
    const approvals = fakeApprovals();
    const { api } = setup({ approvals });
    const options = callOptions(newThread(), { requestId: "call-1" });
    approvals.failNext({ kind: "store", error: { kind: "busy" } });
    const store = await rejection(api.ask({ questions: [SCOPE] }, options));
    expect(store.data).toMatchObject({ code: "unavailable", retryable: true });
    approvals.failNext({ kind: "rejected", code: "approvals.request_invalid", detail: "bad" });
    const rejected = await rejection(api.ask({ questions: [SCOPE] }, options));
    expect(rejected.data).toMatchObject({
      code: "invalid_input",
      detail: { code: "approvals.request_invalid" },
    });
  });

  test("같은 requestId로 다른 질문을 보내면 internal이다", async () => {
    const { api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    await api.ask({ questions: [SCOPE] }, options);
    const error = await rejection(api.ask({ questions: [NO_DEFAULT] }, options));
    expect(error.data).toMatchObject({ code: "internal", detail: { reason: "key_reused" } });
  });

  test("규칙 밖 답이 기록되어 있으면 cancelled(dismissed)로 끝내고 로그를 남긴다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    h.approvals.forceResolve(first.approvalId, "answer", { scope: { selected: ["huge"] } });
    expect(await api.ask({ questions: [SCOPE] }, options)).toMatchObject({
      status: "cancelled",
      reason: "dismissed",
    });
    expect(h.lines.map((line) => line.event)).toContain("dialog.ask_answer_invalid");
  });

  test("질문에 allow 응답이 기록되어도 cancelled(dismissed)로 본다", async () => {
    const { h, api } = setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    h.approvals.forceResolve(first.approvalId, "allow", null);
    expect(await api.ask({ questions: [SCOPE] }, options)).toMatchObject({
      status: "cancelled",
      reason: "dismissed",
    });
  });
});

describe("긴 requestId", () => {
  test("48자를 넘는 키는 줄이되 앞이 같은 서로 다른 키는 다른 요청이 된다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const prefix = "p".repeat(60);
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-a` }));
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-b` }));
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-a` }));
    expect(h.approvals.entries()).toHaveLength(2);
    for (const request of h.approvals.requests) {
      expect(request.requestId.length).toBeLessThanOrEqual(48);
    }
  });
});
