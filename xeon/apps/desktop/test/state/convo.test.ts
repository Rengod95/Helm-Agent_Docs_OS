// convo.ts 순수 함수 시험. 값 비교만 쓴다. 같은 사건을 두 번 먹여도, 순서가 뒤바뀌어도 결과가 같은지 본다.
import { describe, expect, test } from "bun:test";
import type { ItemRecord, StepCompletedPayload, TurnId } from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload, ApprovalResolvedPayload } from "@fresnel/contracts/records";
import {
  EMPTY_THREAD_CONVO,
  convoApply,
  convoApprovalRequested,
  convoApprovalResolved,
  convoItemRecorded,
  convoModelChanged,
  convoToolProgress,
  convoTurnCompleted,
  convoTurnNotice,
  convoTurnStarted,
  tailLines,
  turnEndOf,
  type Convo,
  type ConvoAt,
  type ConvoEvent,
} from "../../src/state/engine/convo.ts";
import { approvalRequest, evt, itm, thr, trn, userItem } from "./helpers.ts";

const T0 = Date.parse("2026-11-12T00:00:00.000Z");
const isoAt = (sec: number): string => new Date(T0 + sec * 1000).toISOString();
const pos = (seq: number, turnId: TurnId | null = null, sec = 0): ConvoAt => ({
  seq,
  eventId: evt(seq),
  turnId,
  at: isoAt(sec),
});
const thread = (c: Convo) => c[thr(1)];

const start = (c: Convo, seq: number, sec: number, origin: "user" | "scheduled" = "user"): Convo =>
  convoTurnStarted(c, {
    ...pos(seq, trn(1), sec),
    threadId: thr(1),
    origin,
    scopeId: null,
    requestId: null,
    inputItemIds: [],
    model: "m1",
  });

const finish = (
  c: Convo,
  seq: number,
  sec: number,
  status: "completed" | "failed" | "interrupted",
  stepCount: number,
  error: string | null = null,
): Convo =>
  convoTurnCompleted(c, {
    ...pos(seq, trn(1), sec),
    threadId: thr(1),
    status,
    stepCount,
    usage: null,
    error,
  });

const step = (
  c: Convo,
  seq: number,
  sec: number,
  stepIndex: number,
  stopReason: StepCompletedPayload["stopReason"],
): Convo =>
  convoApply(c, thr(1), pos(seq, trn(1), sec), {
    kind: "step.completed",
    payload: {
      stepIndex,
      status: "completed",
      stopReason,
      assistantItemId: null,
      toolResultItemIds: [],
    },
  });

/** 도구 결과 item. 도구 호출 id는 "c1"이다 */
const resultItem = (details: Record<string, string | string[]>): ItemRecord => ({
  itemId: itm(7),
  status: "completed",
  kind: "toolResult",
  message: {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "shell",
    content: [],
    details,
    isError: false,
    timestamp: 0,
  },
  effectId: null,
});

describe("tailLines", () => {
  test("25줄이면 마지막 20줄만 남긴다", () => {
    const text = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(tailLines(text)).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i + 6}`));
  });

  test("끝의 빈 줄을 버리고 CRLF를 LF로 본다", () => {
    expect(tailLines("a\r\nb\n\n")).toEqual(["a", "b"]);
  });

  test("400자를 넘는 줄은 400자와 …로 자르고, 정확히 400자는 그대로 둔다", () => {
    expect(tailLines("x".repeat(401))).toEqual([`${"x".repeat(400)}…`]);
    expect(tailLines("y".repeat(400))).toEqual(["y".repeat(400)]);
  });
});

describe("convoToolProgress", () => {
  test("두 번 받으면 마지막 줄, 받은 글자 합, 갱신 수 2", () => {
    const c1 = convoToolProgress({}, thr(1), "c1", itm(1), "a\nb");
    const c2 = convoToolProgress(c1, thr(1), "c1", itm(1), "c\nd\ne");
    expect(thread(c2)?.tools["c1"]).toMatchObject({
      toolCallId: "c1",
      progress: { itemId: itm(1), lines: ["c", "d", "e"], receivedChars: 8, updates: 2 },
    });
    expect(thread(c2)?.toolOrder).toEqual(["c1"]);
  });

  test("진행 출력이 25줄이면 줄 목록은 20줄이다", () => {
    const text = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
    const c = convoToolProgress({}, thr(1), "c1", itm(1), text);
    expect(thread(c)?.tools["c1"]?.progress?.lines).toHaveLength(20);
  });
});

describe("턴 기록", () => {
  test("시작, 단계 0·1, 완료: steps 2, durationMs 5000, 끝 종류 completed", () => {
    let c = start({}, 1, 0);
    c = step(c, 2, 1, 0, "toolUse");
    c = step(c, 3, 2, 1, "stop");
    c = finish(c, 4, 5, "completed", 2);
    expect(thread(c)?.turns[0]).toMatchObject({
      turnId: trn(1),
      startedSeq: 1,
      startedAt: isoAt(0),
      model: "m1",
      steps: 2,
      lastStepIndex: 1,
      lastStopReason: "stop",
      completion: {
        status: "completed",
        stepCount: 2,
        durationMs: 5000,
        end: { kind: "completed" },
      },
    });
  });

  test("단계 1(stop)이 먼저 와도 마지막 단계는 1이고 stopReason은 stop이다", () => {
    let c = start({}, 1, 0);
    c = step(c, 2, 2, 1, "stop");
    c = step(c, 3, 1, 0, "toolUse");
    expect(thread(c)?.turns[0]).toMatchObject({
      steps: 2,
      lastStepIndex: 1,
      lastStopReason: "stop",
    });
  });

  test("같은 단계 사건을 두 번 먹여도 결과가 같다", () => {
    const once = step(start({}, 1, 0), 2, 1, 1, "stop");
    expect(step(once, 2, 1, 1, "stop")).toEqual(once);
  });

  test("완료가 시작보다 먼저 와도 걸린 시간은 시작 뒤에 채워진다", () => {
    const c = start(finish({}, 3, 5, "completed", 1), 1, 0);
    expect(thread(c)?.turns[0]).toMatchObject({ startedSeq: 1, completion: { durationMs: 5000 } });
  });

  test("같은 시작을 두 번 먹여도 결과가 같다", () => {
    const once = start({}, 1, 0);
    expect(start(once, 1, 0)).toEqual(once);
  });

  test("끝 종류: 실패는 메시지, step_limit와 child_limit는 limit, 그 밖의 중단은 code", () => {
    expect(turnEndOf("completed", null)).toEqual({ kind: "completed" });
    expect(turnEndOf("failed", "boom")).toEqual({ kind: "failed", message: "boom" });
    expect(turnEndOf("interrupted", "step_limit")).toEqual({ kind: "limit", limit: "step_limit" });
    expect(turnEndOf("interrupted", "child_limit")).toEqual({
      kind: "limit",
      limit: "child_limit",
    });
    expect(turnEndOf("interrupted", "user")).toEqual({ kind: "interrupted", code: "user" });
    expect(turnEndOf("interrupted", null)).toEqual({ kind: "interrupted", code: null });
  });

  test("convoTurnCompleted도 같은 끝 종류를 completion에 싣는다", () => {
    const failed = finish(start({}, 1, 0), 2, 1, "failed", 0, "boom");
    expect(thread(failed)?.turns[0]?.completion?.end).toEqual({ kind: "failed", message: "boom" });
    const limited = finish(start({}, 1, 0), 2, 1, "interrupted", 1, "step_limit");
    expect(thread(limited)?.turns[0]?.completion?.end).toEqual({
      kind: "limit",
      limit: "step_limit",
    });
  });
});

describe("턴 알림과 중단", () => {
  test("같은 알림은 한 번만 붙이고 다른 값은 따로 붙인다", () => {
    let c: Convo = {};
    c = convoTurnNotice(c, thr(1), trn(1), { code: "gate_limit", limit: 3 });
    c = convoTurnNotice(c, thr(1), trn(1), { code: "gate_limit", limit: 3 });
    c = convoTurnNotice(c, thr(1), trn(1), { code: "repeat_detected", kind: "tool", count: 2 });
    c = convoTurnNotice(c, thr(1), trn(1), { code: "repeat_detected", kind: "tool", count: 2 });
    expect(thread(c)?.turns[0]?.notices).toEqual([
      { code: "gate_limit", limit: 3 },
      { code: "repeat_detected", kind: "tool", count: 2 },
    ]);
  });

  test("턴 id가 없는 알림은 convo를 그대로 돌려준다", () => {
    const c: Convo = {};
    expect(convoTurnNotice(c, thr(1), null, { code: "gate_limit", limit: 1 })).toBe(c);
  });

  test("turn.abort_requested는 턴의 abort를 채운다", () => {
    const c = convoApply({}, thr(1), pos(2, trn(1), 1), {
      kind: "turn.abort_requested",
      payload: { reason: { code: "user", message: null }, cause: "direct", background: false },
    });
    expect(thread(c)?.turns[0]?.abort).toEqual({
      code: "user",
      message: null,
      cause: "direct",
      background: false,
    });
  });
});

describe("승인 기록", () => {
  const request: ApprovalRequestedPayload = {
    ...approvalRequest(thr(1)),
    origin: { threadId: thr(1), turnId: trn(1), stepId: null, toolCallId: "c1", caller: "main" },
    title: "Run shell",
    body: {
      kind: "tool",
      tool: { toolName: "shell", risk: "high", args: {}, argsHash: "h1", ruleId: null },
    },
  };
  const resolved: ApprovalResolvedPayload = {
    approvalId: evt(10),
    decision: "allow",
    answer: null,
    remember: "thread",
    requestedRemember: "always",
    resolvedBy: "user",
  };

  test("다른 기기가 답한 해결은 기록에 기기 id가 남고, 이 컴퓨터의 답에는 없다", () => {
    const requested = convoApprovalRequested({}, thr(1), evt(10), request);
    const remote = convoApprovalResolved(requested, thr(1), pos(11, trn(1), 1), {
      ...resolved,
      deviceId: "dev_0123456789abcdef",
    });
    expect(thread(remote)?.tools["c1"]?.approvals.map((trail) => trail.deviceId)).toEqual([
      "dev_0123456789abcdef",
    ]);
    const local = convoApprovalResolved(requested, thr(1), pos(11, trn(1), 1), resolved);
    expect(thread(local)?.tools["c1"]?.approvals.map((trail) => "deviceId" in trail)).toEqual([
      false,
    ]);
  });

  test("요청 뒤의 해결은 도구 호출에 decision·remember·resolvedBy·caller를 남긴다", () => {
    const requested = convoApprovalRequested({}, thr(1), evt(10), request);
    const c = convoApprovalResolved(requested, thr(1), pos(11, trn(1), 1), resolved);
    expect(thread(c)?.tools["c1"]?.approvals).toEqual([
      {
        approvalId: evt(10),
        decision: "allow",
        remember: "thread",
        requestedRemember: "always",
        resolvedBy: "user",
        title: "Run shell",
        caller: "main",
        bodyKind: "tool",
        toolName: "shell",
        seq: 11,
        at: isoAt(1),
      },
    ]);
  });

  test("같은 해결을 다시 먹이면 convo가 그대로다", () => {
    const requested = convoApprovalRequested({}, thr(1), evt(10), request);
    const once = convoApprovalResolved(requested, thr(1), pos(11, trn(1), 1), resolved);
    expect(convoApprovalResolved(once, thr(1), pos(11, trn(1), 1), resolved)).toBe(once);
  });

  test("요청을 본 적 없는 해결은 convo를 바꾸지 않는다", () => {
    const c = convoTurnNotice({}, thr(1), trn(1), { code: "gate_limit", limit: 1 });
    const once: ApprovalResolvedPayload = { ...resolved, remember: "once" };
    expect(convoApprovalResolved(c, thr(1), pos(11, trn(1), 1), once)).toBe(c);
  });

  test("요청을 못 본 해결이라도 허용 + 이 대화에서는 쓰기 허용 표시를 켠다(DP-205)", () => {
    const c = convoApprovalResolved({}, thr(1), pos(11, trn(1), 1), resolved);
    expect(thread(c)?.writeAccessAllowed).toBe(true);
    expect(thread(c)?.looseApprovals).toEqual([]);
    const denied = convoApprovalResolved({}, thr(1), pos(11, trn(1), 1), {
      ...resolved,
      decision: "deny",
    });
    expect(thread(denied)?.writeAccessAllowed).toBeUndefined();
  });

  test("빈 convo에 요청 없는 해결을 먹여도 같은 객체를 돌려준다 (의심 사항, 아래 보고 참고)", () => {
    const empty: Convo = {};
    expect(
      convoApprovalResolved(empty, thr(1), pos(11, trn(1), 1), { ...resolved, remember: "once" }),
    ).toBe(empty);
  });
});

describe("도구 결과의 개입", () => {
  test("guard 차단은 guard_denied 개입이 되고 도구 호출에 붙는다", () => {
    const c = convoItemRecorded(
      {},
      thr(1),
      pos(7, trn(1), 3),
      resultItem({ code: "denied_by_guard", extension: "g", reason: "r", outcome: "blocked" }),
    );
    expect(thread(c)?.tools["c1"]?.interventions).toEqual([
      {
        kind: "guard_denied",
        extension: "g",
        reason: "r",
        detail: "blocked",
        seq: 7,
        at: isoAt(3),
      },
    ]);
  });

  test("extension 차단은 hook_denied 개입이 된다", () => {
    const c = convoItemRecorded(
      {},
      thr(1),
      pos(7, trn(1), 3),
      resultItem({ code: "denied_by_extension", extension: "e", reason: "x", outcome: "blocked" }),
    );
    expect(thread(c)?.tools["c1"]?.interventions).toEqual([
      { kind: "hook_denied", extension: "e", reason: "x", detail: "blocked", seq: 7, at: isoAt(3) },
    ]);
  });

  test("resultPatchedBy는 hook_patched 개입이고 이름 목록을 detail에 싣는다", () => {
    const c = convoItemRecorded(
      {},
      thr(1),
      pos(7, trn(1), 3),
      resultItem({ resultPatchedBy: ["a", "b"] }),
    );
    expect(thread(c)?.tools["c1"]?.interventions).toEqual([
      { kind: "hook_patched", extension: "a", reason: null, detail: "a, b", seq: 7, at: isoAt(3) },
    ]);
  });

  test("같은 개입을 두 번 넣어도 하나만 남는다", () => {
    const denied = resultItem({
      code: "denied_by_guard",
      extension: "g",
      reason: "r",
      outcome: "blocked",
    });
    const once = convoItemRecorded({}, thr(1), pos(7, trn(1), 3), denied);
    const twice = convoItemRecorded(once, thr(1), pos(8, trn(1), 4), denied);
    expect(thread(twice)?.tools["c1"]?.interventions).toHaveLength(1);
  });

  test("도구 결과가 아닌 item은 convo를 바꾸지 않는다", () => {
    const c = convoTurnNotice({}, thr(1), trn(1), { code: "gate_limit", limit: 1 });
    expect(convoItemRecorded(c, thr(1), pos(7, trn(1), 3), userItem(1))).toBe(c);
  });
});

describe("묶이지 않은 개입과 표지", () => {
  test("secret.masked는 묶이지 않은 개입이 되고 같은 것은 한 번만 남는다", () => {
    const masked: ConvoEvent = {
      kind: "secret.masked",
      payload: { hits: [], layer: "tool-result", at: 1 },
    };
    const once = convoApply({}, thr(1), pos(5, null, 1), masked);
    const twice = convoApply(once, thr(1), pos(6, null, 2), masked);
    expect(thread(twice)?.looseInterventions).toEqual([
      {
        kind: "secret_masked",
        extension: null,
        reason: null,
        detail: "tool-result",
        seq: 5,
        at: isoAt(1),
      },
    ]);
  });

  test("권한 모드 설정만 표지가 되고 다른 설정은 convo를 바꾸지 않는다", () => {
    const before = convoApply({}, thr(1), pos(3, null, 1), {
      kind: "settings.changed",
      payload: { key: "l1.tools.permissionMode", scope: "user", value: "plan" },
    });
    expect(thread(before)?.markers).toEqual([
      { seq: 3, at: isoAt(1), change: { kind: "permission_mode", value: "plan" } },
    ]);
    const after = convoApply(before, thr(1), pos(4, null, 2), {
      kind: "settings.changed",
      payload: { key: "l1.other.key", scope: "user", value: 1 },
    });
    expect(after).toBe(before);
  });

  test("thread.resumed와 thread.leaf_moved는 seq 오름차순 표지가 된다", () => {
    let c = convoApply({}, thr(1), pos(7, trn(1), 3), {
      kind: "thread.resumed",
      payload: { turnId: trn(1), attempt: 2, mode: "auto", fromCheckpointId: null },
    });
    c = convoApply(c, thr(1), pos(6, trn(1), 2), {
      kind: "thread.leaf_moved",
      payload: { leafEventId: evt(9), reason: "rewind" },
    });
    expect(thread(c)?.markers).toEqual([
      {
        seq: 6,
        at: isoAt(2),
        change: { kind: "leaf_moved", reason: "rewind", leafEventId: evt(9) },
      },
      { seq: 7, at: isoAt(3), change: { kind: "resumed", attempt: 2, mode: "auto" } },
    ]);
  });

  test("예약 출처 turn.started만 scheduled_start 표지가 된다", () => {
    const scheduled = start({}, 8, 4, "scheduled");
    expect(thread(scheduled)?.markers).toEqual([
      { seq: 8, at: isoAt(4), change: { kind: "scheduled_start", turnId: trn(1) } },
    ]);
    expect(thread(start({}, 8, 4, "user"))?.markers).toEqual([]);
  });

  test("모델 변경은 문자열일 때만 표지다", () => {
    const c = convoModelChanged({}, thr(1), pos(4, null, 2), "m2");
    expect(thread(c)?.markers).toEqual([
      { seq: 4, at: isoAt(2), change: { kind: "model", model: "m2" } },
    ]);
    expect(convoModelChanged(c, thr(1), pos(5), undefined)).toBe(c);
    expect(convoModelChanged(c, thr(1), pos(5), null)).toBe(c);
  });
});

describe("EMPTY_THREAD_CONVO", () => {
  test("모양이 고정돼 있고 갱신 함수가 바꾸지 않는다", () => {
    convoTurnNotice({}, thr(1), trn(1), { code: "gate_limit", limit: 1 });
    expect(EMPTY_THREAD_CONVO).toEqual({
      turns: [],
      tools: {},
      toolOrder: [],
      approvalDigests: {},
      approvalOrder: [],
      looseInterventions: [],
      looseApprovals: [],
      writeAccessAllowed: false,
      leases: [],
      agents: [],
      judgments: [],
      goal: null,
      tasks: {},
      taskOrder: [],
      markers: [],
    });
  });
});
