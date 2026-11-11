import { describe, expect, test } from "bun:test";
import type { EventWire, VolatileEventWire } from "@fresnel/contracts/wire";
import { decodeDurable, decodeVolatile } from "../../src/state/engine/decode.ts";
import { evt, itm, thr, trn } from "./helpers.ts";

// 대화 화면이 읽는 내구 kind(`convo`)의 디코드와 휘발 사건(도구 진행, 턴 알림)의 디코드를 값으로 확인한다.

const T = thr(1);
const CHILD = thr(2);
const TURN = trn(1);
const AT = "2026-11-07T00:00:00.000Z";
const RECEIVED = 1_000_000;

function wire(seq: number, kind: EventWire["kind"], payload: unknown): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: T,
    turnId: TURN,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

function volatileWire(
  n: number,
  kind: VolatileEventWire["kind"],
  payload: unknown,
): VolatileEventWire {
  return {
    id: evt(500 + n),
    kind,
    version: 1,
    durable: false,
    threadId: T,
    turnId: TURN,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    n,
    afterSeq: 5,
    payload,
  };
}

/** 유효한 페이로드마다 한 줄. 같은 kind의 `{}`는 읽을 수 없는 사실이다 */
const CONVO: readonly (readonly [EventWire["kind"], unknown])[] = [
  [
    "step.completed",
    {
      stepIndex: 0,
      status: "completed",
      stopReason: "stop",
      assistantItemId: null,
      toolResultItemIds: [],
    },
  ],
  [
    "turn.abort_requested",
    { reason: { code: "user", message: null }, cause: "direct", background: false },
  ],
  [
    "agent.spawned",
    {
      childThreadId: CHILD,
      agent: "worker",
      requestId: "req-child-1",
      owner: { kind: "scope", scopeId: "scope-1" },
      caller: "subagent:worker",
      depth: 1,
      background: false,
      fork: null,
      modelRole: "default",
    },
  ],
  [
    "agent.judged",
    {
      goalRef: "g1",
      run: 1,
      verdict: "met",
      rationale: "ok",
      missing: [],
      usage: null,
      model: { provider: "anthropic", modelId: "claude-haiku-5-5" },
    },
  ],
  [
    "agent.settled",
    {
      childThreadId: CHILD,
      requestId: "req-child-1",
      status: "completed",
      report: null,
      answerItemId: null,
      usage: null,
      error: null,
    },
  ],
  [
    "work.goal_set",
    {
      goal: {
        goalId: "g1",
        condition: "테스트를 통과한다",
        judge: { kind: "model" },
        maxRuns: 3,
        continuation: "self",
        judgments: 0,
        status: "active",
        lastVerdict: null,
      },
    },
  ],
  [
    "work.goal_judged",
    {
      goalId: "g1",
      n: 1,
      turnId: TURN,
      verdict: { met: true, reason: "ok", missing: [] },
      judgeKind: "model",
      failure: null,
      usage: null,
    },
  ],
  ["work.goal_settled", { goalId: "g1", status: "met", judgments: 1 }],
  [
    "work.task_created",
    {
      task: {
        id: "t1",
        content: "할 일",
        activeForm: null,
        status: "pending",
        owner: null,
        blockedBy: [],
      },
      ref: null,
    },
  ],
  [
    "work.task_changed",
    { taskId: "t1", from: "pending", set: { status: "in_progress" }, cause: "call" },
  ],
  ["work.task_linked", { taskId: "t2", blockedBy: ["t1"] }],
  ["work.task_unlinked", { taskId: "t2", blockedBy: ["t1"] }],
  ["thread.leaf_moved", { leafEventId: evt(7), reason: "branch" }],
  [
    "thread.branch_summarized",
    { fromEventId: evt(8), summary: "요약", details: null, usage: null },
  ],
  ["thread.resumed", { turnId: TURN, attempt: 1, mode: "manual", fromCheckpointId: null }],
  ["settings.changed", { key: "theme.mode", scope: "user", value: "dark" }],
  ["tool.sandbox_bypassed", { toolCallId: "call_1", toolName: "shell", reason: "escape", at: 1 }],
  ["tool.untrusted_read", { turnId: TURN, toolCallId: "call_1", toolName: "web_fetch", at: 1 }],
  [
    "secret.used",
    {
      handle: "secret://api-key",
      mode: "env",
      toolCallId: null,
      host: null,
      commandHash: null,
      leaseId: "lease-1",
      at: 1,
    },
  ],
  [
    "secret.denied",
    {
      handle: "secret://api-key",
      mode: "env",
      reason: "not_granted",
      purpose: "테스트",
      toolCallId: null,
      at: 1,
    },
  ],
  [
    "secret.approved",
    {
      handle: "secret://api-key",
      scope: "per-session",
      approvalId: evt(9),
      expiresAt: null,
      at: 1,
    },
  ],
  ["secret.masked", { hits: [{ kind: "api-key", count: 1 }], layer: "tool-result", at: 1 }],
];

describe("내구 convo kind의 디코드", () => {
  CONVO.forEach(([kind, payload], i) => {
    test(`${kind}: 유효한 페이로드는 convo 사실이다`, () => {
      expect(decodeDurable(wire(i + 1, kind, payload))).toMatchObject({
        type: "convo",
        seq: i + 1,
        event: { kind, payload },
      });
    });

    test(`${kind}: 빈 페이로드는 읽을 수 없는 사실이다`, () => {
      expect(decodeDurable(wire(i + 1, kind, {}))).toMatchObject({
        type: "unreadable",
        seq: i + 1,
      });
    });
  });

  test("turn.started: origin이 없으면 user이고 scopeId·requestId를 start에 싣는다", () => {
    expect(
      decodeDurable(
        wire(1, "turn.started", { inputItemIds: [], requestId: "req-1", scopeId: "scope-1" }),
      ),
    ).toMatchObject({
      type: "turn.started",
      start: { origin: "user", scopeId: "scope-1", requestId: "req-1" },
    });
  });

  test("turn.started: origin이 있으면 그 값을 싣는다", () => {
    expect(
      decodeDurable(
        wire(2, "turn.started", {
          inputItemIds: [],
          origin: "scheduled",
          requestId: "req-2",
          scopeId: "scope-2",
        }),
      ),
    ).toMatchObject({
      type: "turn.started",
      start: { origin: "scheduled", scopeId: "scope-2", requestId: "req-2" },
    });
  });

  test("approval.resolved는 해결의 내용 resolved를 싣는다", () => {
    const payload = {
      approvalId: evt(9),
      decision: "allow",
      answer: null,
      remember: "once",
      requestedRemember: null,
      resolvedBy: "user",
    };
    expect(decodeDurable(wire(3, "approval.resolved", payload))).toMatchObject({
      type: "approval.resolved",
      approvalId: evt(9),
      resolved: { decision: "allow", remember: "once" },
    });
  });
});

describe("휘발 사건의 디코드", () => {
  test("item.updated의 tool_progress는 본문 글 조각을 이어 붙이고 이미지 조각은 무시한다", () => {
    const event = volatileWire(3, "item.updated", {
      itemId: itm(4),
      update: {
        kind: "tool_progress",
        partialResult: {
          content: [
            { type: "text", text: "ab" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
            { type: "text", text: "cd" },
          ],
          details: { x: 1 },
        },
      },
    });
    expect(decodeVolatile(event, RECEIVED)).toMatchObject({
      type: "tool.progress",
      n: 3,
      threadId: T,
      turnId: TURN,
      itemId: itm(4),
      text: "abcd",
    });
  });

  test("turn.updated의 gate_limit은 턴 알림 사실이다", () => {
    const event = volatileWire(4, "turn.updated", {
      status: "running",
      notice: { code: "gate_limit", detail: { limit: 3 } },
    });
    expect(decodeVolatile(event, RECEIVED)).toMatchObject({
      type: "turn.notice",
      notice: { code: "gate_limit", limit: 3 },
    });
  });

  test("turn.updated의 repeat_detected는 턴 알림 사실이다", () => {
    const event = volatileWire(5, "turn.updated", {
      status: "running",
      notice: { code: "repeat_detected", detail: { kind: "action_observation", count: 4 } },
    });
    expect(decodeVolatile(event, RECEIVED)).toMatchObject({
      type: "turn.notice",
      notice: { code: "repeat_detected", kind: "action_observation", count: 4 },
    });
  });
});
