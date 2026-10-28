import { expect, test } from "bun:test";
import type { ApprovalBody, ApprovalRequest, ApprovalRequestInput } from "@xeon/contracts/services";
import { requestIssue, validateResponse } from "../src/approvals/protocol.ts";
import { createHarness } from "./support/harness.ts";

// M3a F 계약 변경(승인 kind review)을 받는 최소 컴파일 수정의 동작: 구현(M3-REQ-74) 전까지 검토 승인은 거부한다.

const REVIEW: ApprovalBody = {
  kind: "review",
  review: {
    reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "refactor",
    round: 1,
    files: [{ path: "a.ts", change: "modified", binary: false, hunks: 1 }],
  },
};

test("a review approval request is refused with a reason until M3-REQ-74 lands", async () => {
  const h = await createHarness();
  const input: ApprovalRequestInput = {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "rvw-1",
    title: "Review the changes",
    body: REVIEW,
    remember: ["once"],
  };
  expect(requestIssue(input)).toBe("review approvals are not implemented yet");
});

test("a review request that was recorded earlier accepts deny only", async () => {
  const h = await createHarness();
  const request: ApprovalRequest = {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "rvw-1",
    title: "Review the changes",
    body: REVIEW,
    remember: ["once"],
    approvalId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    surfaceThreadId: h.thread,
    requestedAt: 0,
  };
  const answer = validateResponse(request, { decision: "answer", answer: {} });
  expect(answer.ok ? null : answer.error.kind).toBe("decision_not_allowed");
  const allow = validateResponse(request, { decision: "allow" });
  expect(allow.ok ? null : allow.error.kind).toBe("decision_not_allowed");
  const deny = validateResponse(request, { decision: "deny" });
  expect(deny.ok).toBe(true);
});
