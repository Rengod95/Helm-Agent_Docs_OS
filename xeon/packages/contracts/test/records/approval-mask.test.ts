import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import type { LeafMask } from "../../src/conversation/index.ts";
import {
  ApprovalRequestedPayloadSchema,
  maskApprovalRequest,
  type ApprovalRequestedPayload,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 승인 카드의 제목, 출처, 본문(도구 인자, 계획, 질문, 검토)은 호스트가 준 구간으로 가린다. 요청 키와 식별자는 바뀌지 않는다.

const THREAD = rawId("thr", 1);
const VALUE = "maskprobe";
const REVIEW_ID = "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ARTIFACT_ID = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function build(title: string, body: unknown, caller = "main"): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId: THREAD, turnId: null, stepId: null, toolCallId: null, caller },
    requestKey: "req-1",
    title,
    body,
    remember: ["once"],
    surfaceThreadId: THREAD,
    requestedAt: 1,
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

const TOOL_ARGS = {
  command: `curl token=${VALUE} https://example.test`,
  nested: { list: ["keep", "me"] },
};
const TOOL_BODY = {
  kind: "tool",
  tool: { toolName: "bash", risk: "write", args: TOOL_ARGS, argsHash: "hash-1", ruleId: null },
};

/** 값이 든 자리의 표식. 값의 위치는 시험이 문자열에서 찾는다 */
function kvLeaf(pointer: string, text: string): LeafMask {
  const start = text.indexOf(VALUE);
  return { pointer, len: text.length, ranges: [{ start, end: start + VALUE.length, label: "kv" }] };
}

describe("maskApprovalRequest", () => {
  test("the title and the tool arguments are masked; identifiers and the rest are unchanged", () => {
    const title = `Run bash with token=${VALUE}`;
    const payload = build(title, TOOL_BODY);
    const before = JSON.stringify(payload);
    const command = TOOL_ARGS.command;
    const leaves = [kvLeaf("/title", title), kvLeaf("/body/tool/args/command", command)];

    const masked = maskApprovalRequest(payload, leaves);
    expect(masked).not.toBeNull();
    if (masked === null || masked.body.kind !== "tool") return;
    expect(masked.title).toBe("Run bash with token=[REDACTED:kv]");
    expect(masked.body.tool.args).toEqual({
      command: "curl token=[REDACTED:kv] https://example.test",
      nested: { list: ["keep", "me"] },
    });
    expect(masked.requestKey).toBe("req-1");
    expect(masked.surfaceThreadId).toBe(payload.surfaceThreadId);
    expect(masked.body.tool.toolName).toBe("bash");
    expect(JSON.stringify(payload)).toBe(before);
    expect(JSON.stringify(masked)).not.toContain(VALUE);
  });

  test("an MCP server name and its declared hints survive masking, and a marked server name is masked", () => {
    const mcpBody = {
      kind: "tool",
      tool: {
        toolName: "echo",
        risk: "exec",
        args: { text: "hi" },
        argsHash: "hash-2",
        ruleId: "mcp.default",
        mcp: { server: `qa-${VALUE}`, declared: { readOnlyHint: true } },
      },
    };
    const payload = build('Allow tool "echo"?', mcpBody);
    const server = `qa-${VALUE}`;
    const unmarked = maskApprovalRequest(payload, [kvLeaf("/title", 'Allow tool "echo"?')]);
    expect(unmarked?.body.kind === "tool" && unmarked.body.tool.mcp).toStrictEqual({
      server,
      declared: { readOnlyHint: true },
    });
    const marked = maskApprovalRequest(payload, [kvLeaf("/body/tool/mcp/server", server)]);
    expect(marked?.body.kind === "tool" && marked.body.tool.mcp).toStrictEqual({
      server: "qa-[REDACTED:kv]",
      declared: { readOnlyHint: true },
    });
  });

  test("without leaves the request is returned as it is", () => {
    const payload = build("Run bash", TOOL_BODY);
    expect(maskApprovalRequest(payload, undefined)).toBe(payload);
    expect(maskApprovalRequest(payload, [])).toBe(payload);
  });

  test("the origin caller is masked too", () => {
    const payload = build("Run bash", TOOL_BODY, `ext:token=${VALUE}`);
    const caller = payload.origin.caller;
    const masked = maskApprovalRequest(payload, [kvLeaf("/origin/caller", caller)]);
    expect(masked?.origin.caller).toBe("ext:token=[REDACTED:kv]");
  });

  test("a plan body has its text masked, and a non-string plan (a blob) is kept as it is", () => {
    const text = `step one with token=${VALUE}`;
    const payload = build("Plan", {
      kind: "plan",
      plan: { plan: text, planRef: null, nextModes: ["default"] },
    });
    const masked = maskApprovalRequest(payload, [kvLeaf("/body/plan/plan", text)]);
    expect(masked?.body.kind === "plan" ? masked.body.plan.plan : null).toBe(
      "step one with token=[REDACTED:kv]",
    );
    expect(JSON.stringify(masked)).not.toContain(VALUE);
  });

  test("a question's text and option labels are masked; its ids are unchanged", () => {
    const text = `Use token=${VALUE}?`;
    const payload = build("Ask", {
      kind: "question",
      question: {
        questions: [
          {
            id: "q1",
            text,
            options: [{ id: "o1", label: `token=${VALUE}`, recommended: true }],
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      },
    });
    const masked = maskApprovalRequest(payload, [
      kvLeaf("/body/question/questions/0/text", text),
      kvLeaf("/body/question/questions/0/options/0/label", `token=${VALUE}`),
    ]);
    const body = masked?.body;
    if (body?.kind !== "question") throw new Error("expected a question body");
    const [q] = body.question.questions;
    expect(q?.text).toBe("Use token=[REDACTED:kv]?");
    expect(q?.options[0]?.label).toBe("token=[REDACTED:kv]");
    expect(q?.id).toBe("q1");
    expect(q?.options[0]?.id).toBe("o1");
    expect(JSON.stringify(masked)).not.toContain(VALUE);
  });

  test("a review's title and file paths are masked; its ids are unchanged", () => {
    const path = `secrets/token=${VALUE}.env`;
    const payload = build("Review", {
      kind: "review",
      review: {
        reviewId: REVIEW_ID,
        artifactId: ARTIFACT_ID,
        title: "Review",
        round: 1,
        files: [{ path, change: "added", binary: false, hunks: 1 }],
      },
    });
    const masked = maskApprovalRequest(payload, [kvLeaf("/body/review/files/0/path", path)]);
    const body = masked?.body;
    if (body?.kind !== "review") throw new Error("expected a review body");
    expect(body.review.files[0]?.path).toBe("secrets/token=[REDACTED:kv].env");
    expect(body.review.reviewId).toBe(REVIEW_ID);
    expect(body.review.artifactId).toBe(ARTIFACT_ID);
  });

  test("a length that does not match the leaf hides that field as unverified, not raw", () => {
    const payload = build(`Run with token=${VALUE}`, TOOL_BODY);
    const masked = maskApprovalRequest(payload, [{ pointer: "/title", len: 99, ranges: [] }]);
    expect(masked?.title).toBe("[REDACTED:unverified]");
  });

  test("a tool argument leaf pointing at a non-string makes the request unreadable (null)", () => {
    const payload = build("Run bash", TOOL_BODY);
    const leaves: LeafMask[] = [{ pointer: "/body/tool/args/nested", len: 0, ranges: [] }];
    expect(maskApprovalRequest(payload, leaves)).toBeNull();
  });
});
