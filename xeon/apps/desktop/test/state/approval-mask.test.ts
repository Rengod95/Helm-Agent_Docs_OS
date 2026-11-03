import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { LeafMask } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable, decodePendingApprovals } from "../../src/state/engine/decode.ts";
import { toolApprovalView } from "../../src/views/approval-form.ts";
import { evt, thr } from "./helpers.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 승인 카드의 제목과 도구 인자는 호스트의 표식을 적용한 뒤에만 거울과 화면에 들어간다. 값은 거울에 들어가지 않는다.

const SECRET = "maskprobe-value-one";
const TITLE = `Run bash with ${SECRET}`;
const COMMAND = `curl -H token=${SECRET} https://example.test`;
const CREATED = "2026-10-24T00:00:00.000Z";

function approvalPayload(): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "req-1",
    title: TITLE,
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "write",
        args: { command: COMMAND },
        argsHash: "h",
        ruleId: null,
      },
    },
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 1,
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

/** 호스트가 만들 표식과 같은 모양. 제목과 명령의 값 위치를 문자열에서 찾는다 */
function maskOf(text: string, pointer: string): LeafMask {
  const start = text.indexOf(SECRET);
  return {
    pointer,
    len: text.length,
    ranges: [{ start, end: start + SECRET.length, label: "known:display-token" }],
  };
}

function approvalWire(seq: number, payload: unknown, mask?: LeafMask[]): EventWire {
  return {
    id: evt(seq),
    kind: "approval.requested",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: thr(1),
    turnId: null,
    stepId: null,
    recordedAt: CREATED,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
    ...(mask === undefined ? {} : { mask }),
  };
}

const LEAVES: LeafMask[] = [maskOf(TITLE, "/title"), maskOf(COMMAND, "/body/tool/args/command")];

describe("approval.requested from the wire", () => {
  test("the title and the tool argument are masked in the state; the event payload is unchanged", () => {
    const payload = approvalPayload();
    const wire = approvalWire(7, payload, LEAVES);
    const before = JSON.stringify(wire.payload);

    const fact = decodeDurable(wire);
    expect(fact.type).toBe("approval.requested");
    if (fact.type !== "approval.requested") return;
    expect(fact.request.title).toBe("Run bash with [REDACTED:known:display-token]");
    expect(fact.request.body.kind === "tool" ? fact.request.body.tool.args : null).toEqual({
      command: "curl -H token=[REDACTED:known:display-token] https://example.test",
    });
    expect(JSON.stringify(wire.payload)).toBe(before);
    expect(JSON.stringify(fact)).not.toContain(SECRET);
  });

  test("the approval card's argument text carries the marker, not the value", () => {
    const fact = decodeDurable(approvalWire(8, approvalPayload(), LEAVES));
    if (fact.type !== "approval.requested" || fact.request.body.kind !== "tool") {
      throw new Error("expected a tool approval");
    }
    const view = toolApprovalView(fact.request.body.tool);
    expect(view.argsText ?? "").toContain("[REDACTED:known:display-token]");
    expect(view.argsText ?? "").not.toContain(SECRET);
  });

  test("a mask that does not fit the request makes the approval unreadable, not raw", () => {
    const wire = approvalWire(9, approvalPayload(), [
      { pointer: "/body/tool/args", len: 0, ranges: [] },
    ]);
    expect(decodeDurable(wire)).toMatchObject({ type: "unreadable" });
  });
});

describe("approval.list snapshot", () => {
  test("the pending approvals get their masks by approval id; a request that does not fit is left out", () => {
    const request = approvalPayload();
    const approvalId = evt(3);
    const masks = [{ approvalId, leaves: LEAVES }];
    const out = decodePendingApprovals({ approvals: [{ approvalId, seq: 3, request }], masks });
    expect(out).toHaveLength(1);
    expect(out[0]?.request.title).toBe("Run bash with [REDACTED:known:display-token]");
    expect(JSON.stringify(out)).not.toContain(SECRET);

    const bad = decodePendingApprovals({
      approvals: [{ approvalId, seq: 3, request }],
      masks: [{ approvalId, leaves: [{ pointer: "/body/tool/args", len: 0, ranges: [] }] }],
    });
    expect(bad).toEqual([]);
  });

  test("an approval without a mask entry passes through unchanged", () => {
    const request = approvalPayload();
    const approvalId = evt(4);
    expect(decodePendingApprovals({ approvals: [{ approvalId, seq: 4, request }] })).toEqual([
      { approvalId, seq: 4, request },
    ]);
  });
});
