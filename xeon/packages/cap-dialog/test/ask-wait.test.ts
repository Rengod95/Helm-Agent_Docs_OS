import { describe, expect, test } from "bun:test";
import { CapabilityError, type AskQuestion } from "@xeon/contracts/capabilities";
import { createAskService } from "../src/ask/service.ts";
import { callOptions, flushTicks, harness, newThread } from "./support/harness.ts";
import { realApprovals } from "./support/real-approvals.ts";

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};

describe("메모리 대기", () => {
  test("wait: true는 응답 시 완료 출력을 돌려준다", async () => {
    const h = harness({ approvals: await realApprovals() });
    const { api } = createAskService(h.deps);
    const pending = api.ask(
      { questions: [SCOPE], wait: true },
      callOptions(newThread(), { requestId: "call-1" }),
    );
    // 요청이 나간 뒤에 응답한다
    await flushTicks();
    const [entry] = h.approvals.entries();
    if (entry === undefined) throw new Error("the request was not made");
    await h.approvals.respond(entry.approvalId, "answer", { scope: { selected: ["large"] } });
    expect(await pending).toMatchObject({
      status: "answered",
      defaulted: false,
      answers: [{ questionId: "scope", selected: ["large"] }],
    });
  });

  test("이미 해결된 요청이면 기다리지 않고 바로 돌려준다", async () => {
    const h = harness({ approvals: await realApprovals() });
    const { api } = createAskService(h.deps);
    const options = callOptions(newThread(), { requestId: "call-1" });
    const first = await api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await h.approvals.respond(first.approvalId, "answer", { scope: { selected: ["small"] } });
    expect(await api.ask({ questions: [SCOPE], wait: true }, options)).toMatchObject({
      status: "answered",
    });
  });

  test("signal 취소는 aborted 오류를 내고 승인 요청은 남는다", async () => {
    const h = harness({ approvals: await realApprovals() });
    const { api } = createAskService(h.deps);
    const controller = new AbortController();
    const pending = api.ask(
      { questions: [SCOPE], wait: true },
      callOptions(newThread(), { requestId: "call-1", signal: controller.signal }),
    );
    await flushTicks();
    controller.abort();
    const error = await pending.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CapabilityError);
    expect(error instanceof CapabilityError ? error.data.code : "").toBe("aborted");
    const [entry] = h.approvals.entries();
    expect(entry === undefined ? undefined : h.approvals.snapshotOf(entry.approvalId)?.state).toBe(
      "pending",
    );
  });

  test("만료가 닿으면 대기 중인 호출도 풀린다", async () => {
    const h = harness({ approvals: await realApprovals() });
    const { api } = createAskService(h.deps);
    const pending = api.ask(
      { questions: [SCOPE], wait: true, timeoutSec: 10 },
      callOptions(newThread(), { requestId: "call-1" }),
    );
    await flushTicks();
    await h.timers.advance(10_000);
    expect(await pending).toMatchObject({ status: "answered", defaulted: true });
  });
});
