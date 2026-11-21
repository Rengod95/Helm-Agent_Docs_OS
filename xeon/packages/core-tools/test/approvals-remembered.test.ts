import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  SCRIPT_RUN_RULE_PREFIX,
  type ApprovalRequestInput,
  type ApprovalService,
} from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createApprovalService } from "../src/approvals/service.ts";
import { createHarness, expectOk, type Harness } from "./support/harness.ts";

// L1.tools.spec §4.7 기억 범위. 대화 단위로 기억하는 "thread" 허용은 드래프트 스크립트 실행 카드(SCRIPT_RUN_RULE_PREFIX)만 제안한다
// [결정: 2026-11-19 사용자, AGE-58]. 기록에서 읽는 기억(재시작 뒤, 하위 대화가 부모의 선택을 물려받음)을 이 규칙으로 시험한다.

const SCRIPT_RULE = `${SCRIPT_RUN_RULE_PREFIX}draft-1`;

function scriptInput(
  h: Harness,
  key: string,
  overrides: Partial<ApprovalRequestInput> = {},
): ApprovalRequestInput {
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Run the draft script?",
    body: {
      kind: "tool",
      tool: {
        toolName: "script",
        risk: "write",
        args: { subject: "script_run" },
        argsHash: "h1",
        ruleId: SCRIPT_RULE,
      },
    },
    remember: ["thread"],
    ...overrides,
  };
}

function rest(approvals: ApprovalService): NonNullable<ApprovalService["remembered"]> {
  if (approvals.remembered === undefined) throw new Error("remembered is missing");
  return approvals.remembered.bind(approvals);
}

test("only the script run card may offer thread; every other card stays once-only", async () => {
  const h = await createHarness();
  const ok = await h.runtime.approvals.open(scriptInput(h, "script-1"));
  expect(ok.ok).toBe(true);

  const withOnce = await h.runtime.approvals.open(
    scriptInput(h, "script-2", { remember: ["once", "thread"] }),
  );
  expect(withOnce.ok).toBe(false);

  const otherRule = scriptInput(h, "tool-1");
  const body =
    otherRule.body.kind === "tool"
      ? { ...otherRule.body, tool: { ...otherRule.body.tool, ruleId: "tools.replace" } }
      : otherRule.body;
  const refused = await h.runtime.approvals.open({ ...otherRule, body });
  expect(refused.ok).toBe(false);
});

test("allow with thread remembers the conversation; deny does not", async () => {
  const h = await createHarness();
  const remembered = rest(h.runtime.approvals);

  const denied = expectOk(await h.runtime.approvals.open(scriptInput(h, "script-deny")));
  await h.runtime.approvals.respond(denied.request.approvalId, { decision: "deny" });
  expect(expectOk(await remembered(h.thread, SCRIPT_RULE))).toBe(false);

  const all = expectOk(await h.runtime.approvals.open(scriptInput(h, "script-all")));
  expect(
    await h.runtime.approvals.respond(all.request.approvalId, {
      decision: "allow",
      remember: "thread",
    }),
  ).toEqual({ applied: true });
  expect(expectOk(await remembered(h.thread, SCRIPT_RULE))).toBe(true);
  const resolved = h.runtime.approvals.get(all.request.approvalId)?.resolution;
  expect(resolved).toMatchObject({ decision: "allow", remember: "thread" });
});

test("another conversation is not covered, and the choice survives a restart (read from the record)", async () => {
  const h = await createHarness();
  const other: ThreadId = fixedIdFactory().next("thr");
  const all = expectOk(await h.runtime.approvals.open(scriptInput(h, "script-all")));
  await h.runtime.approvals.respond(all.request.approvalId, {
    decision: "allow",
    remember: "thread",
  });
  const remembered = rest(h.runtime.approvals);
  expect(expectOk(await remembered(other, SCRIPT_RULE))).toBe(false);

  // 재시작: 같은 세션 위의 새 서비스는 메모리 없이 기록에서 읽는다
  const fresh = createApprovalService({
    session: h.deps.session,
    producer: h.deps.producer,
    ids: h.deps.ids,
    clock: h.deps.clock,
    ext: h.deps.ext,
    logger: undefined,
    callOf: () => undefined,
  });
  expect(expectOk(await rest(fresh)(h.thread, SCRIPT_RULE))).toBe(true);
  expect(expectOk(await rest(fresh)(other, SCRIPT_RULE))).toBe(false);
});

test("a child conversation inherits the parent's choice", async () => {
  const h = await createHarness();
  const child: ThreadId = fixedIdFactory().next("thr");
  const all = expectOk(await h.runtime.approvals.open(scriptInput(h, "script-all")));
  await h.runtime.approvals.respond(all.request.approvalId, {
    decision: "allow",
    remember: "thread",
  });
  const service = createApprovalService({
    session: h.deps.session,
    producer: h.deps.producer,
    ids: h.deps.ids,
    clock: h.deps.clock,
    ext: h.deps.ext,
    logger: undefined,
    callOf: () => undefined,
    requesterOf: (threadId) =>
      threadId === child ? { surfaceThreadId: h.thread, caller: "main" } : undefined,
  });
  expect(expectOk(await rest(service)(child, SCRIPT_RULE))).toBe(true);
});
