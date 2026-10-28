import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ApprovalRequestInput, ApprovalService } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createBareL2ApprovalsPort } from "../../src/assembly/l2-approvals.ts";
import { partial } from "../fixtures/unsafe.ts";

// 결정 L6: L2 requestId가 승인 요청 키가 되는 규칙. 기댓값은 시험이 따로 계산한 실제 sha256 앞 40자(`h_` 접두)다.

/** F `requestKeyFor`가 긴 원문에 돌려주는 모양: `h_` + sha256 hex 앞 40자 */
function hashedKey(raw: string): string {
  return `h_${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

const ids = fixedIdFactory(900);
const THREAD = ids.next("thr");
const SUBJECT = {
  questions: [
    {
      id: "color",
      text: "Which color?",
      multiSelect: false,
      allowFreeText: false,
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
    },
  ],
};

/** open에 들어온 requestKey만 기록하는 승인 서비스 */
function recordingApprovals(keys: string[]): ApprovalService {
  const approvalId = ids.next("evt");
  return partial<ApprovalService>({
    open: (input: ApprovalRequestInput) => {
      keys.push(input.requestKey);
      return Promise.resolve(
        ok({
          request: { ...input, approvalId, surfaceThreadId: THREAD, requestedAt: 1 },
          resolution: null,
        }),
      );
    },
  });
}

async function keyOf(requestId: string): Promise<string | undefined> {
  const keys: string[] = [];
  const port = createBareL2ApprovalsPort(recordingApprovals(keys));
  await port.request({ threadId: THREAD, kind: "question", subject: SUBJECT, requestId });
  return keys[0];
}

test("a request id that already has the key shape is the request key as it is", async () => {
  expect(await keyOf("call_1.ask-2")).toBe("call_1.ask-2");
});

test("a hashed key made by a capability with requestKeyFor is not hashed a second time", async () => {
  const capabilityKey = hashedKey("x".repeat(60));
  expect(capabilityKey).toHaveLength(42);
  expect(await keyOf(capabilityKey)).toBe(capabilityKey);
  expect(await keyOf(capabilityKey)).not.toBe(hashedKey(capabilityKey));
});

test("a request id that is not an approval request key is rejected, not hashed", async () => {
  const keys: string[] = [];
  const port = createBareL2ApprovalsPort(recordingApprovals(keys));
  const results = await Promise.all(
    ["ask one/two", "h_plain", "a:b"].map((requestId) =>
      port.request({ threadId: THREAD, kind: "question", subject: SUBJECT, requestId }),
    ),
  );
  const rejection = {
    ok: false as const,
    error: {
      kind: "rejected" as const,
      code: "approvals.request_invalid",
      detail: "requestId must be an approval request key made with requestKeyFor",
    },
  };
  expect(results).toEqual([rejection, rejection, rejection]);
  expect(keys).toEqual([]);
});

test("a request id longer than 48 characters is rejected before any approval is opened", async () => {
  const keys: string[] = [];
  const port = createBareL2ApprovalsPort(recordingApprovals(keys));
  const result = await port.request({
    threadId: THREAD,
    kind: "question",
    subject: SUBJECT,
    requestId: "x".repeat(49),
  });
  expect(result).toEqual({
    ok: false,
    error: {
      kind: "rejected",
      code: "approvals.request_invalid",
      detail: "requestId must be 1-48 characters",
    },
  });
  expect(keys).toEqual([]);
});
