import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { isId } from "@xeon/contracts/conversation";
import type { ApprovalRequestInput, ApprovalResolution } from "@xeon/contracts/services";
import { createBrowseConfirm } from "../../src/assembly/web-browse-confirm.ts";

// host-service spec §10 43번. cap-web의 BrowseConfirmPort를 xeon.approvals의 차단형 승인으로 잇는다.

const THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";

function resolution(decision: ApprovalResolution["decision"]): ApprovalResolution {
  return {
    approvalId: "evt_x",
    decision,
    answer: null,
    remember: "once",
    requestedRemember: null,
    resolvedBy: "user",
  };
}

function fakeApprovals(answer: ApprovalResolution["decision"] | "fail") {
  const seen: ApprovalRequestInput[] = [];
  return {
    seen,
    approvals: {
      request: (input: ApprovalRequestInput) => {
        seen.push(input);
        return Promise.resolve(
          answer === "fail"
            ? err({ kind: "rejected" as const, code: "x", detail: null })
            : ok(resolution(answer)),
        );
      },
    },
  };
}

const signal = new AbortController().signal;

test("a confirmation becomes a blocking tool approval and maps allow and deny to the port's answers", async () => {
  if (!isId("thr", THREAD)) throw new Error("fixture thread id is invalid");
  const request = {
    threadId: THREAD,
    sessionId: "bs_1",
    reason: "sensitive_click" as const,
    url: "https://shop.example/checkout",
    role: "button",
    name: "Pay now",
    requestKey: "k1",
  };
  const allowed = fakeApprovals("allow");
  expect(await createBrowseConfirm(allowed.approvals).confirm(request, signal)).toEqual({
    ok: true,
    value: "allow",
  });
  const sent = allowed.seen[0];
  expect(sent?.title).toBe(
    "Allow the browser to click a sensitive control on https://shop.example/checkout?",
  );
  expect(sent?.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "web_browse_confirm",
      risk: "write",
      ruleId: "web.browse.confirm",
      args: { reason: "sensitive_click", role: "button", name: "Pay now" },
    },
  });
  expect(sent?.origin.threadId).toBe(THREAD);

  const denied = fakeApprovals("deny");
  expect(await createBrowseConfirm(denied.approvals).confirm(request, signal)).toEqual({
    ok: true,
    value: "deny",
  });
});

test("without a conversation or when the request fails the port is unavailable", async () => {
  const fine = fakeApprovals("allow");
  const noThread = await createBrowseConfirm(fine.approvals).confirm(
    {
      threadId: undefined,
      sessionId: "bs",
      reason: "named_profile",
      url: "https://a.example",
      requestKey: "k",
    },
    signal,
  );
  expect(noThread.ok).toBe(false);
  expect(fine.seen).toEqual([]);
  if (!isId("thr", THREAD)) throw new Error("fixture thread id is invalid");
  const failing = fakeApprovals("fail");
  const failed = await createBrowseConfirm(failing.approvals).confirm(
    {
      threadId: THREAD,
      sessionId: "bs",
      reason: "named_profile",
      url: "https://a.example",
      requestKey: "k",
    },
    signal,
  );
  expect(failed).toEqual({
    ok: false,
    error: { kind: "unavailable", message: "the confirmation could not be requested" },
  });
});
