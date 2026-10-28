import { describe, expect, test } from "bun:test";
import {
  DialogAsk,
  DialogAside,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  DialogStyles,
  type AskQuestion,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";
import { createAskService } from "../src/ask/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { realApprovals } from "./support/real-approvals.ts";

// M3-REQ-88·89, ADR-0015 §3.6: 멱등 쓰기(`dialog.ask.ask`)는 같은 requestId를 두 번 불러도 효과가 한 번이고 결과가 같다.
// 승인 서비스는 core-tools의 실제 구현이다. 사이에 새 서비스를 세워 재시작을 흉내 낸다.
// `dialog.notify.emit`은 공급자가 없어 선언 없음이고, 공급자는 M3(plan D11)에서 만든다. 그 적합성 시험은 공급자가 들어올 때 더한다.

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};

function classes(def: AnyCapabilityDef): readonly string[] {
  return Object.entries(def.service.methods).map(([name, method]) => {
    const effect =
      method.readOnly === true ? "readOnly" : method.idempotent === true ? "idempotent" : "none";
    return `${def.id}.${name} ${effect} ${method.replay ?? "unsafe"}`;
  });
}

describe("dialog effect classes", () => {
  test("the declared classes follow the spec table", () => {
    const defs = [
      DialogAsk,
      DialogCommands,
      DialogStatus,
      DialogAttachments,
      DialogAside,
      DialogStyles,
      DialogNotify,
    ];
    expect(defs.flatMap((def) => classes(def))).toEqual([
      "dialog.ask.ask idempotent safe",
      "dialog.commands.register none unsafe",
      "dialog.commands.list readOnly safe",
      "dialog.commands.expand readOnly safe",
      "dialog.commands.run none unsafe",
      "dialog.status.setItem none unsafe",
      "dialog.status.clearItem none unsafe",
      "dialog.status.list readOnly safe",
      "dialog.attachments.add none unsafe",
      "dialog.aside.ask none unsafe",
      "dialog.styles.register none unsafe",
      "dialog.styles.select none unsafe",
      "dialog.notify.emit none unsafe",
      "dialog.notify.list readOnly safe",
    ]);
  });
});

describe("dialog.ask idempotency", () => {
  test("the same requestId twice, with a restart between, is one approval request and the same result", async () => {
    const approvals = await realApprovals();
    const options = callOptions(newThread(), { requestId: "idem-1" });
    const before = createAskService(harness({ approvals }).deps);
    const first = await before.api.ask({ questions: [SCOPE] }, options);
    expect(first.status).toBe("input_required");
    before.dispose();

    const restarted = await approvals.restart();
    const after = createAskService(harness({ approvals: restarted }).deps);
    const second = await after.api.ask({ questions: [SCOPE] }, options);

    expect(second).toEqual(first);
    expect(approvals.entries()).toHaveLength(1);
    after.dispose();
  });

  test("a different requestId is a different request", async () => {
    const approvals = await realApprovals();
    const thread = newThread();
    const service = createAskService(harness({ approvals }).deps);
    const one = await service.api.ask(
      { questions: [SCOPE] },
      callOptions(thread, { requestId: "idem-a" }),
    );
    const two = await service.api.ask(
      { questions: [SCOPE] },
      callOptions(thread, { requestId: "idem-b" }),
    );
    expect(one.approvalId === two.approvalId).toBe(false);
    expect(approvals.entries()).toHaveLength(2);
    service.dispose();
  });

  test("a call without a requestId is rejected before any request is made", async () => {
    const approvals = await realApprovals();
    const service = createAskService(harness({ approvals }).deps);
    const options = callOptions(newThread(), {});
    const failure = await service.api.ask({ questions: [SCOPE] }, options).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(failure).toMatchObject({ data: { code: "invalid_input" } });
    expect(approvals.entries()).toHaveLength(0);
    service.dispose();
  });
});
