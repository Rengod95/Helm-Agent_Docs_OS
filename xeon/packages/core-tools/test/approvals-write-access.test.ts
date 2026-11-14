import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  WRITE_ACCESS_RULE_ID,
  type ApprovalRequestInput,
  type ApprovalService,
} from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createApprovalService } from "../src/approvals/service.ts";
import { createHarness, expectOk, type Harness } from "./support/harness.ts";

// L1.tools.spec §4.7 6번의 예외: 샌드박스 밖 쓰기 허용 승인(ruleId sandbox.write_access)만 once와 thread를 함께 제안한다 [결정: 2026-11-13 사용자]

function writeAccessInput(
  h: Harness,
  key: string,
  overrides: Partial<ApprovalRequestInput> = {},
): ApprovalRequestInput {
  const args = {
    subject: "write_access",
    tool: "bash",
    command: "npm ci",
    writePaths: ["/Users/u/.npm/_logs/1.log"],
    allowRoots: ["/Users/u/.npm"],
    homeWide: false,
  };
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Allow writing outside the workspace?",
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "write",
        args,
        argsHash: "h1",
        ruleId: WRITE_ACCESS_RULE_ID,
      },
    },
    remember: ["once", "thread"],
    ...overrides,
  };
}

function rest(approvals: ApprovalService): NonNullable<ApprovalService["remembered"]> {
  if (approvals.remembered === undefined) throw new Error("remembered is missing");
  return approvals.remembered.bind(approvals);
}

test("only the write access rule may offer thread; every other request stays once-only", async () => {
  const h = await createHarness();
  const ok = await h.runtime.approvals.open(writeAccessInput(h, "wa-1"));
  expect(ok.ok).toBe(true);

  const otherRule = writeAccessInput(h, "wa-2");
  const body =
    otherRule.body.kind === "tool"
      ? { ...otherRule.body, tool: { ...otherRule.body.tool, ruleId: "tools.replace" } }
      : otherRule.body;
  const refused = await h.runtime.approvals.open({ ...otherRule, body });
  expect(refused.ok ? null : refused.error).toMatchObject({
    kind: "rejected",
    code: "approvals.request_invalid",
  });

  const lists = [["once", "thread", "always"], ["thread"], ["once", "always"]] as const;
  const results = await Promise.all(
    lists.map((remember, index) =>
      h.runtime.approvals.open(writeAccessInput(h, `wa-bad-${index}`, { remember })),
    ),
  );
  expect(results.map((result) => result.ok)).toEqual([false, false, false]);
});

test("the three choices: allow+thread remembers, allow+once and deny do not", async () => {
  const h = await createHarness();
  const remembered = rest(h.runtime.approvals);
  const once = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-once")));
  expect(await h.runtime.approvals.respond(once.request.approvalId, { decision: "allow" })).toEqual(
    { applied: true },
  );
  expect(expectOk(await remembered(h.thread, WRITE_ACCESS_RULE_ID))).toBe(false);

  const denied = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-deny")));
  await h.runtime.approvals.respond(denied.request.approvalId, { decision: "deny" });
  expect(expectOk(await remembered(h.thread, WRITE_ACCESS_RULE_ID))).toBe(false);

  const all = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-all")));
  expect(
    await h.runtime.approvals.respond(all.request.approvalId, {
      decision: "allow",
      remember: "thread",
    }),
  ).toEqual({ applied: true });
  expect(expectOk(await remembered(h.thread, WRITE_ACCESS_RULE_ID))).toBe(true);
  const resolved = h.runtime.approvals.get(all.request.approvalId)?.resolution;
  expect(resolved).toMatchObject({ decision: "allow", remember: "thread" });
});

test("a legacy card that sends only allow means once", async () => {
  const h = await createHarness();
  const opened = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-legacy")));
  await h.runtime.approvals.respond(opened.request.approvalId, { decision: "allow" });
  expect(h.runtime.approvals.get(opened.request.approvalId)?.resolution?.remember).toBe("once");
});

test("another conversation is not covered, and the choice survives a restart (read from the record)", async () => {
  const h = await createHarness();
  const other: ThreadId = fixedIdFactory().next("thr");
  const all = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-all")));
  await h.runtime.approvals.respond(all.request.approvalId, {
    decision: "allow",
    remember: "thread",
  });
  const remembered = rest(h.runtime.approvals);
  expect(expectOk(await remembered(other, WRITE_ACCESS_RULE_ID))).toBe(false);

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
  expect(expectOk(await rest(fresh)(h.thread, WRITE_ACCESS_RULE_ID))).toBe(true);
  expect(expectOk(await rest(fresh)(other, WRITE_ACCESS_RULE_ID))).toBe(false);
});

test("a child conversation inherits the parent's choice", async () => {
  const h = await createHarness();
  const child: ThreadId = fixedIdFactory().next("thr");
  const all = expectOk(await h.runtime.approvals.open(writeAccessInput(h, "wa-all")));
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
  expect(expectOk(await rest(service)(child, WRITE_ACCESS_RULE_ID))).toBe(true);
});
