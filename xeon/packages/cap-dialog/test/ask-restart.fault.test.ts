import { describe, expect, test } from "bun:test";
import type { AskQuestion } from "@xeon/contracts/capabilities";
import { createAskService } from "../src/ask/service.ts";
import { fakeApprovals } from "./support/fake-approvals.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

// 재시작은 새 런타임(ask 서비스)이 같은 승인 기록(가짜가 내구 상태를 가진다)을 받는 것으로 흉내 낸다.
// 도구 결과 완료 커밋 1건(`tool:<toolCallId>:result`)은 L1.tools의 몫이라 통합 단계에서 확인한다(plan 6의 M2 항목 2).

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};

describe("재시작 후 단일 완료", () => {
  test("답 기록 뒤 재시작해 세 번 재시도해도 승인 요청은 하나이고 같은 답을 받는다", async () => {
    const approvals = fakeApprovals();
    const thread = newThread();
    const options = callOptions(thread, { requestId: "tool-call-7" });

    const before = createAskService(harness({ approvals }).deps);
    const first = await before.api.ask({ questions: [SCOPE] }, options);
    if (first.status !== "input_required") throw new Error("expected input_required");
    await approvals.respond(first.approvalId, "answer", { scope: { selected: ["large"] } });
    before.dispose();

    const after = createAskService(harness({ approvals }).deps);
    const retries = [
      await after.api.ask({ questions: [SCOPE] }, options),
      await after.api.ask({ questions: [SCOPE] }, options),
      await after.api.ask({ questions: [SCOPE] }, options),
    ];
    for (const retry of retries) {
      expect(retry).toEqual({
        status: "answered",
        approvalId: first.approvalId,
        answers: [{ questionId: "scope", selected: ["large"], text: null }],
        defaulted: false,
      });
    }
    expect(approvals.entries()).toHaveLength(1);
  });

  test("답이 없을 때 재시작해도 같은 승인 요청을 이어 받고 새 요청을 만들지 않는다", async () => {
    const approvals = fakeApprovals();
    const options = callOptions(newThread(), { requestId: "tool-call-8" });
    const before = createAskService(harness({ approvals }).deps);
    const first = await before.api.ask({ questions: [SCOPE] }, options);
    before.dispose();
    const after = createAskService(harness({ approvals }).deps);
    const second = await after.api.ask({ questions: [SCOPE] }, options);
    expect(second).toEqual(first);
    expect(approvals.entries()).toHaveLength(1);
  });

  test("재시작하면 시간 제한을 처음부터 다시 잰다(내구 만료는 L1.tools 몫이다)", async () => {
    const approvals = fakeApprovals();
    const options = callOptions(newThread(), { requestId: "tool-call-9" });
    const first = harness({ approvals });
    const before = createAskService(first.deps);
    await before.api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    await first.timers.advance(20_000);
    before.dispose();
    const second = harness({ approvals });
    const after = createAskService(second.deps);
    const resumed = await after.api.ask({ questions: [SCOPE], timeoutSec: 30 }, options);
    expect(resumed.status).toBe("input_required");
    await second.timers.advance(29_000);
    expect(approvals.snapshotOf(resumed.approvalId)?.state).toBe("pending");
    await second.timers.advance(1_000);
    expect(approvals.snapshotOf(resumed.approvalId)?.state).toBe("resolved");
  });
});
