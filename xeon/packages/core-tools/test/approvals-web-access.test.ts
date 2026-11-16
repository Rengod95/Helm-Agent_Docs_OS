import { expect, test } from "bun:test";
import {
  WEB_ACCESS_RULE_ID,
  type ApprovalRemember,
  type ApprovalRequestInput,
} from "@fresnel/contracts/services";
import { createHarness, expectOk, type Harness } from "./support/harness.ts";

// L1.tools.spec §4.7 6번의 예외 2: 웹 접근 승인(ruleId web.access)만 once, always, thread를 이 순서로 함께 제안한다 [결정: 2026-11-15 사용자]

function webAccessInput(
  h: Harness,
  key: string,
  overrides: Partial<ApprovalRequestInput> = {},
  ruleId: string = WEB_ACCESS_RULE_ID,
): ApprovalRequestInput {
  const args = {
    subject: "web_access",
    host: "docs.example.com",
    url: "https://docs.example.com/a",
    reasons: ["policy_ask"],
  };
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Allow web access to docs.example.com?",
    body: {
      kind: "tool",
      tool: { toolName: "web.fetch", risk: "read", args, argsHash: "h1", ruleId },
    },
    remember: ["once", "always", "thread"],
    ...overrides,
  };
}

test("only the web access rule may offer the three-way list", async () => {
  const h = await createHarness();
  expect((await h.runtime.approvals.open(webAccessInput(h, "wb-1"))).ok).toBe(true);

  const otherRule = await h.runtime.approvals.open(webAccessInput(h, "wb-2", {}, "tools.replace"));
  expect(otherRule.ok ? null : otherRule.error).toMatchObject({
    kind: "rejected",
    code: "approvals.request_invalid",
  });

  const lists: readonly (readonly ApprovalRemember[])[] = [
    ["once", "thread", "always"],
    ["once", "always"],
    ["once", "thread"],
    ["always", "thread"],
  ];
  const results = await Promise.all(
    lists.map((remember, index) =>
      h.runtime.approvals.open(webAccessInput(h, `wb-bad-${index}`, { remember })),
    ),
  );
  expect(results.map((result) => result.ok)).toEqual([false, false, false, false]);
});

test("a once-only web access request stays allowed (secret-looking URL)", async () => {
  const h = await createHarness();
  const opened = await h.runtime.approvals.open(
    webAccessInput(h, "wb-once", { remember: ["once"] }),
  );
  expect(opened.ok).toBe(true);
});

const CHOICES: readonly {
  readonly name: string;
  readonly response: { readonly decision: "allow" | "deny"; readonly remember?: ApprovalRemember };
  readonly expected: ApprovalRemember;
}[] = [
  { name: "allow means once", response: { decision: "allow" }, expected: "once" },
  { name: "allow+always", response: { decision: "allow", remember: "always" }, expected: "always" },
  { name: "allow+thread", response: { decision: "allow", remember: "thread" }, expected: "thread" },
  { name: "deny keeps once", response: { decision: "deny" }, expected: "once" },
];

test.each(CHOICES)("choice recorded as given: $name", async ({ name, response, expected }) => {
  const h = await createHarness();
  const opened = expectOk(await h.runtime.approvals.open(webAccessInput(h, name.slice(0, 40))));
  expect(await h.runtime.approvals.respond(opened.request.approvalId, response)).toEqual({
    applied: true,
  });
  expect(h.runtime.approvals.get(opened.request.approvalId)?.resolution).toMatchObject({
    decision: response.decision,
    remember: expected,
  });
});

test("a response outside the offered list is refused", async () => {
  const h = await createHarness();
  const opened = expectOk(
    await h.runtime.approvals.open(webAccessInput(h, "wb-narrow", { remember: ["once"] })),
  );
  expect(
    await h.runtime.approvals.respond(opened.request.approvalId, {
      decision: "allow",
      remember: "always",
    }),
  ).toMatchObject({ applied: false, reason: "answer_invalid" });
});
