import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { err, parse } from "@xeon/contracts";
import { CapabilityError, DialogAsk, type AskQuestion } from "@xeon/contracts/capabilities";
import { ApprovalBodyJsonSchema, ApprovalRequestedPayloadSchema } from "@xeon/contracts/records";
import { createAskService } from "../src/ask/service.ts";
import { callTool } from "./support/adapter.ts";
import { realApprovals } from "./support/real-approvals.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import type { DialogDeps } from "../src/deps.ts";

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

async function setup(
  options: {
    readonly interactive?: DialogDeps["interactive"];
    /** null이면 승인 서비스 없이 조립한다 */
    readonly approvals?: null;
  } = {},
) {
  const approvals = await realApprovals();
  const interactive = options.interactive === undefined ? {} : { interactive: options.interactive };
  const h =
    options.approvals === null
      ? harness({ ...interactive })
      : harness({ approvals, ...interactive });
  const ask = createAskService(h.deps);
  return { h, approvals, ask, api: ask.api };
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
    const { approvals, api } = await setup();
    const thread = newThread();
    const options = callOptions(thread, { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    expect(first.status).toBe("input_required");
    if (first.status !== "input_required") return;

    expect(await approvals.respond(first.approvalId, "answer", SMALL)).toEqual({ applied: true });
    const second = await api.ask({ questions: [SCOPE] }, options);
    expect(second).toEqual({
      status: "answered",
      approvalId: first.approvalId,
      answers: [{ questionId: "scope", selected: ["small"], text: null }],
      defaulted: false,
    });
    // 승인 요청은 하나다
    expect(approvals.entries()).toHaveLength(1);
  });

  test("deny는 cancelled(dismissed)다", async () => {
    const { approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await approvals.respond(first.approvalId, "deny");
    expect(await api.ask({ questions: [SCOPE] }, options)).toEqual({
      status: "cancelled",
      approvalId: first.approvalId,
      reason: "dismissed",
    });
  });

  test("만료와 추천 답이 있으면 answered(defaulted: true)다", async () => {
    const { h, approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.timers.advance(29_000);
    expect(approvals.snapshotOf(first.approvalId)?.state).toBe("pending");
    await h.timers.advance(1_000);
    expect(approvals.snapshotOf(first.approvalId)?.state).toBe("resolved");
    expect(await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options)).toEqual({
      status: "answered",
      approvalId: first.approvalId,
      answers: [{ questionId: "scope", selected: ["small"], text: null }],
      defaulted: true,
    });
  });

  test("만료와 추천이 없으면 cancelled(timeout)이다", async () => {
    const { h, api } = await setup();
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
    const { h, approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await approvals.respond(first.approvalId, "answer", { scope: { selected: ["large"] } });
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
    const { h, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE], timeoutSec: 0 }, options);
    await h.timers.advance(2 * DAY_MS);
    const later = await api.ask({ questions: [SCOPE], timeoutSec: 0 }, options);
    expect(first.status).toBe("input_required");
    expect(later).toEqual(first);
  });

  test("턴 취소로 승인 요청이 닫히면 재호출은 cancelled(aborted)다", async () => {
    const { approvals, api } = await setup();
    const thread = newThread();
    const options = callOptions(thread, { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await approvals.factory.forCall(undefined).cancel(thread, first.approvalId, "turn aborted");
    expect(await api.ask({ questions: [SCOPE] }, options)).toEqual({
      status: "cancelled",
      approvalId: first.approvalId,
      reason: "aborted",
    });
  });
});

describe("같은 레코드 형식", () => {
  test("ask가 만든 승인 요청은 kind question이고 L1 body 스키마를 통과한다", async () => {
    const { approvals, api } = await setup();
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
    const [request] = approvals.requests;
    expect(request).toMatchObject({ threadId: thread, kind: "question", requestId: "call-1" });
    // L2.work의 계획 승인과 같은 L1 payload 스키마(ApprovalBodyJsonSchema)로 검사한다
    const body = parse(ApprovalBodyJsonSchema, { kind: "question", question: request?.subject });
    expect(body.ok).toBe(true);
    // 호출 문맥은 팩토리에 그대로 간다(origin을 만드는 데 쓴다)
    expect(approvals.contexts[0]?.toolCallId).toBe("toolcall-1");

    // E5: 실제 승인 서비스가 이벤트 로그에 남긴 approval.requested는 계획 승인(cap-work `plans-decision.int.test.ts`)과 같은 레코드 모양이다
    const stored = approvals.session.events.filter((event) => event.kind === "approval.requested");
    expect(stored).toHaveLength(1);
    const payload = parse(ApprovalRequestedPayloadSchema, stored[0]?.payload);
    expect(payload.ok && payload.value.body.kind).toBe("question");
    expect(Object.keys(stored[0]?.payload ?? {}).toSorted()).toEqual([
      "body",
      "origin",
      "remember",
      "requestKey",
      "requestedAt",
      "surfaceThreadId",
      "title",
    ]);
    if (payload.ok) {
      expect(Object.keys(payload.value.origin).toSorted()).toEqual([
        "caller",
        "stepId",
        "threadId",
        "toolCallId",
        "turnId",
      ]);
      expect(payload.value.origin.toolCallId).toBe("toolcall-1");
      expect(payload.value.remember).toEqual(["once"]);
      expect(payload.value.surfaceThreadId).toBe(payload.value.origin.threadId);
    }
  });

  test("도구 어댑터 경로: ask_user는 wait:false로 불린다", async () => {
    const { approvals, api } = await setup();
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
    expect(approvals.entries()).toHaveLength(1);
  });
});

describe("오류", () => {
  test("질문 정의 위반은 ask_invalid_questions이고 승인 요청이 나가지 않는다", async () => {
    const { approvals, api } = await setup();
    const error = await rejection(
      api.ask(
        { questions: [SCOPE, { ...SCOPE }] },
        callOptions(newThread(), { requestId: "call-1" }),
      ),
    );
    expect(error.data.code).toBe("ask_invalid_questions");
    expect(error.data.detail).toMatchObject({ issues: [expect.any(String)] });
    expect(approvals.requests).toHaveLength(0);
  });

  test("비대화형 실행은 ask_unavailable_headless다", async () => {
    const { approvals, api } = await setup({ interactive: () => false });
    const error = await rejection(
      api.ask({ questions: [SCOPE] }, callOptions(newThread(), { requestId: "call-1" })),
    );
    expect(error.data.code).toBe("ask_unavailable_headless");
    expect(approvals.requests).toHaveLength(0);
  });

  test("스레드 문맥이나 requestId가 없으면 invalid_input이다", async () => {
    const { api } = await setup();
    expect((await rejection(api.ask({ questions: [SCOPE] }, { requestId: "x" }))).data.code).toBe(
      "invalid_input",
    );
    expect(
      (await rejection(api.ask({ questions: [SCOPE] }, callOptions(newThread())))).data.code,
    ).toBe("invalid_input");
  });

  test("승인 서비스가 없으면 unavailable이다", async () => {
    const { api } = await setup({ approvals: null });
    const error = await rejection(
      api.ask({ questions: [SCOPE] }, callOptions(newThread(), { requestId: "call-1" })),
    );
    expect(error.data).toMatchObject({
      code: "unavailable",
      detail: { reason: "approvals_missing" },
    });
  });

  test("승인 요청 실패는 값으로 오고 공통 코드로 바뀐다", async () => {
    const { approvals, api, h } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    // 저장소 실패: 실제 승인 서비스의 요청 커밋이 실패한다
    approvals.failNext({ kind: "io", code: "EIO" });
    const store = await rejection(api.ask({ questions: [SCOPE] }, options));
    expect(store.data).toMatchObject({ code: "unavailable", retryable: true });
    expect(approvals.entries()).toHaveLength(0);
    // 같은 요청을 다시 보내면 성공한다(실패한 요청은 기록되지 않았다)
    expect((await api.ask({ questions: [SCOPE] }, options)).status).toBe("input_required");

    // 서비스가 요청을 거부한 경우의 공통 코드 변환(거부 값은 포트 대역이 만든다. 실제 서비스는 질문 검사를 앞에서 이미 통과시킨다)
    const refusing = createAskService({
      ...h.deps,
      approvals: {
        forCall: () => ({
          ...approvals.factory.forCall(undefined),
          request: () =>
            Promise.resolve(
              err({ kind: "rejected", code: "approvals.request_invalid", detail: "bad" }),
            ),
        }),
      },
    });
    const rejected = await rejection(
      refusing.api.ask({ questions: [SCOPE] }, callOptions(newThread(), { requestId: "call-2" })),
    );
    expect(rejected.data).toMatchObject({
      code: "invalid_input",
      detail: { code: "approvals.request_invalid" },
    });
  });

  test("같은 requestId로 다른 질문을 보내면 internal이다", async () => {
    const { approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    await api.ask({ questions: [SCOPE] }, options);
    const error = await rejection(api.ask({ questions: [NO_DEFAULT] }, options));
    expect(error.data).toMatchObject({ code: "internal", detail: { reason: "key_reused" } });
    expect(approvals.entries()).toHaveLength(1);
  });

  test("규칙 밖 답이 기록되어 있으면 cancelled(dismissed)로 끝내고 로그를 남긴다", async () => {
    const { h, approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    approvals.forceResolve(first.approvalId, "answer", { scope: { selected: ["huge"] } });
    // 다른 프로세스가 남긴 기록을 새 서비스가 읽는다
    const later = createAskService({ ...h.deps, approvals: (await approvals.restart()).factory });
    expect(await later.api.ask({ questions: [SCOPE] }, options)).toMatchObject({
      status: "cancelled",
      reason: "dismissed",
    });
    expect(h.lines.map((line) => line.event)).toContain("dialog.ask_answer_invalid");
  });

  test("질문에 allow 응답이 기록되어도 cancelled(dismissed)로 본다", async () => {
    const { h, approvals, api } = await setup();
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    approvals.forceResolve(first.approvalId, "allow", null);
    const later = createAskService({ ...h.deps, approvals: (await approvals.restart()).factory });
    expect(await later.api.ask({ questions: [SCOPE] }, options)).toMatchObject({
      status: "cancelled",
      reason: "dismissed",
    });
  });
});

const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 40);

describe("긴 requestId", () => {
  test("48자를 넘는 키는 h_ + sha256 앞 40자가 되고 앞이 같은 서로 다른 키는 다른 요청이 된다", async () => {
    const { approvals, api } = await setup();
    const thread = newThread();
    const prefix = "p".repeat(60);
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-a` }));
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-b` }));
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: `${prefix}-a` }));
    expect(approvals.entries()).toHaveLength(2);
    expect(approvals.requests.map((request) => request.requestId)).toEqual([
      `h_${digest(`${prefix}-a`)}`,
      `h_${digest(`${prefix}-b`)}`,
      `h_${digest(`${prefix}-a`)}`,
    ]);
  });

  test("키 알파벳 밖 문자가 있는 requestId도 해시 키가 되고 알파벳 안의 48자 이하는 그대로다", async () => {
    const { approvals, api } = await setup();
    const thread = newThread();
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: "call:odd id" }));
    await api.ask({ questions: [SCOPE] }, callOptions(thread, { requestId: "call_plain-1" }));
    const digest = createHash("sha256").update("call:odd id").digest("hex").slice(0, 40);
    expect(approvals.requests.map((request) => request.requestId)).toEqual([
      `h_${digest}`,
      "call_plain-1",
    ]);
  });
});
