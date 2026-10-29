import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { classifyNotice } from "../src/notify/classify.ts";
import { newThread } from "./support/harness.ts";

// L2.dialog.spec §4.7.1 분류 표. 원인 내구 이벤트마다 kind가 맞고 interrupted 턴은 null이다.

const ids = fixedIdFactory(9100);

let seq = 0;
function envelope(threadId: ThreadId, kind: EventKind, payload: unknown): DurableEventEnvelope {
  seq += 1;
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: 1,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

const ORIGIN_CALLER = "main";

function approvalPayload(threadId: ThreadId, body: unknown): unknown {
  return {
    origin: {
      threadId,
      turnId: null,
      stepId: null,
      toolCallId: null,
      caller: ORIGIN_CALLER,
    },
    requestKey: "k",
    title: "t",
    body,
    remember: ["once"],
    surfaceThreadId: threadId,
    requestedAt: 1,
  };
}

const TOOL_BODY = {
  kind: "tool",
  tool: { toolName: "bash", risk: "exec", args: {}, argsHash: "h", ruleId: null },
};

const QUESTION_BODY = {
  kind: "question",
  question: {
    questions: [{ id: "q", text: "?", options: [], multiSelect: false, allowFreeText: true }],
  },
};

function turnPayload(
  status: "completed" | "interrupted" | "failed",
  error: string | null,
): unknown {
  return { status, stepCount: 1, usage: null, error };
}

function settledPayload(thread: ThreadId, status: string, error: string | null): unknown {
  return {
    childThreadId: thread,
    requestId: "req-1",
    status,
    report: null,
    answerItemId: null,
    usage: null,
    error,
  };
}

function runPayload(outcome: string): unknown {
  return { timerId: "tmr_01ARZ3NDEKTSV4RRFFQ69G5FAV", dueAt: 1, outcome };
}

describe("classifyNotice: turn.completed", () => {
  test("completed는 작업이 끝났다는 completed 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "turn.completed", turnPayload("completed", null));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "completed",
      title: "작업이 끝났다",
      body: null,
      seq: event.seq,
      sourceType: "turn.completed",
    });
  });

  test("failed는 턴이 실패했다는 error 알림이고 본문은 오류 문구다", () => {
    const thread = newThread();
    const event = envelope(thread, "turn.completed", turnPayload("failed", "모델 호출 실패"));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "error",
      title: "턴이 실패했다",
      body: "모델 호출 실패",
      seq: event.seq,
      sourceType: "turn.completed",
    });
  });

  test("failed의 긴 오류 문구는 본문 1000자로 자른다", () => {
    const thread = newThread();
    const event = envelope(thread, "turn.completed", turnPayload("failed", "가".repeat(1500)));
    const notice = classifyNotice(event);
    expect(notice?.kind).toBe("error");
    expect(notice?.body).toBe("가".repeat(1000));
  });

  test("interrupted는 사용자가 끊은 것이라 알리지 않는다", () => {
    const thread = newThread();
    const event = envelope(thread, "turn.completed", turnPayload("interrupted", null));
    expect(classifyNotice(event)).toBeNull();
  });
});

describe("classifyNotice: work.goal_settled", () => {
  test("met는 목표를 달성했다는 completed 알림이고 본문에 판정 수가 있다", () => {
    const thread = newThread();
    const event = envelope(thread, "work.goal_settled", {
      goalId: "g1",
      status: "met",
      judgments: 2,
    });
    expect(classifyNotice(event)).toStrictEqual({
      kind: "completed",
      title: "목표를 달성했다",
      body: "판정 2회",
      seq: event.seq,
      sourceType: "work.goal_settled",
    });
  });

  test("limit_reached는 판정 한도 도달 completed 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "work.goal_settled", {
      goalId: "g1",
      status: "limit_reached",
      judgments: 5,
    });
    expect(classifyNotice(event)).toStrictEqual({
      kind: "completed",
      title: "목표 판정 한도에 도달했다",
      body: "판정 5회",
      seq: event.seq,
      sourceType: "work.goal_settled",
    });
  });

  test("judge_failed는 목표 판정에 실패했다는 error 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "work.goal_settled", {
      goalId: "g1",
      status: "judge_failed",
      judgments: 1,
    });
    expect(classifyNotice(event)).toStrictEqual({
      kind: "error",
      title: "목표 판정에 실패했다",
      body: null,
      seq: event.seq,
      sourceType: "work.goal_settled",
    });
  });

  test("cleared와 active는 알리지 않는다", () => {
    const thread = newThread();
    for (const status of ["cleared", "active"]) {
      const event = envelope(thread, "work.goal_settled", { goalId: "g1", status, judgments: 0 });
      expect(classifyNotice(event)).toBeNull();
    }
  });
});

describe("classifyNotice: approval.requested", () => {
  test("tool 승인 대기는 도구 이름을 넣은 approval_waiting이다", () => {
    const thread = newThread();
    const event = envelope(thread, "approval.requested", approvalPayload(thread, TOOL_BODY));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "approval_waiting",
      title: "승인이 필요하다: bash",
      body: null,
      seq: event.seq,
      sourceType: "approval.requested",
    });
  });

  test("plan 승인 대기는 kind를 넣은 approval_waiting이다", () => {
    const thread = newThread();
    const body = { kind: "plan", plan: { plan: "1단계", planRef: null, nextModes: [] } };
    const event = envelope(thread, "approval.requested", approvalPayload(thread, body));
    expect(classifyNotice(event)).toMatchObject({
      kind: "approval_waiting",
      title: "승인이 필요하다: plan",
    });
  });

  test("question 대기는 question_waiting이다", () => {
    const thread = newThread();
    const event = envelope(thread, "approval.requested", approvalPayload(thread, QUESTION_BODY));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "question_waiting",
      title: "질문에 답이 필요하다",
      body: null,
      seq: event.seq,
      sourceType: "approval.requested",
    });
  });

  test("review 승인은 §4.7.1 표에 없어 알리지 않는다", () => {
    const thread = newThread();
    const body = {
      kind: "review",
      review: {
        reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        title: "변경 검토",
        round: 1,
        files: [],
      },
    };
    const event = envelope(thread, "approval.requested", approvalPayload(thread, body));
    expect(classifyNotice(event)).toBeNull();
  });

  test("도구 이름이 길면 제목을 120자로 자른다", () => {
    const thread = newThread();
    const body = {
      kind: "tool",
      tool: { toolName: "t".repeat(128), risk: "exec", args: {}, argsHash: "h", ruleId: null },
    };
    const event = envelope(thread, "approval.requested", approvalPayload(thread, body));
    const notice = classifyNotice(event);
    expect(notice?.title).toHaveLength(120);
    expect(notice?.title.startsWith("승인이 필요하다: ")).toBe(true);
  });
});

describe("classifyNotice: agent.settled", () => {
  test("completed는 백그라운드 작업이 끝났다는 background_completed 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "agent.settled", settledPayload(thread, "completed", null));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "background_completed",
      title: "백그라운드 작업이 끝났다",
      body: null,
      seq: event.seq,
      sourceType: "agent.settled",
    });
  });

  test("error는 백그라운드 작업이 실패했다는 error 알림이고 본문은 오류 문구다", () => {
    const thread = newThread();
    const event = envelope(thread, "agent.settled", settledPayload(thread, "error", "자식 실패"));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "error",
      title: "백그라운드 작업이 실패했다",
      body: "자식 실패",
      seq: event.seq,
      sourceType: "agent.settled",
    });
  });

  test("aborted는 사용자가 끊은 것이라 알리지 않는다", () => {
    const thread = newThread();
    const event = envelope(thread, "agent.settled", settledPayload(thread, "aborted", null));
    expect(classifyNotice(event)).toBeNull();
  });
});

describe("classifyNotice: schedule.run_finished", () => {
  test("completed는 예약 작업이 끝났다는 background_completed 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "schedule.run_finished", runPayload("completed"));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "background_completed",
      title: "예약 작업이 끝났다",
      body: null,
      seq: event.seq,
      sourceType: "schedule.run_finished",
    });
  });

  test("failed는 예약 작업이 실패했다는 error 알림이다", () => {
    const thread = newThread();
    const event = envelope(thread, "schedule.run_finished", runPayload("failed"));
    expect(classifyNotice(event)).toStrictEqual({
      kind: "error",
      title: "예약 작업이 실패했다",
      body: null,
      seq: event.seq,
      sourceType: "schedule.run_finished",
    });
  });

  test("aborted와 awaiting_approval은 알리지 않는다", () => {
    const thread = newThread();
    for (const outcome of ["aborted", "awaiting_approval"]) {
      const event = envelope(thread, "schedule.run_finished", runPayload(outcome));
      expect(classifyNotice(event)).toBeNull();
    }
  });
});

describe("classifyNotice: dialog.notified", () => {
  test("emit으로 남은 알림은 본문과 제목을 그대로 싣고 sourceType은 dialog.notified다", () => {
    const thread = newThread();
    const event = envelope(thread, "dialog.notified", {
      notice: { kind: "question_waiting", title: "그룹 질문", body: "요약", origin: "grp.g1" },
    });
    expect(classifyNotice(event)).toStrictEqual({
      kind: "question_waiting",
      title: "그룹 질문",
      body: "요약",
      seq: event.seq,
      sourceType: "dialog.notified",
    });
  });
});

describe("classifyNotice: 경계", () => {
  test("모양이 맞지 않는 payload는 null이다", () => {
    const thread = newThread();
    for (const kind of [
      "turn.completed",
      "work.goal_settled",
      "approval.requested",
      "agent.settled",
      "schedule.run_finished",
      "dialog.notified",
    ] satisfies EventKind[]) {
      const event = envelope(thread, kind, "not-an-object");
      expect(classifyNotice(event)).toBeNull();
    }
  });

  test("알림 원인이 아닌 종류는 null이다", () => {
    const thread = newThread();
    for (const kind of ["turn.started", "work.task_created"] satisfies EventKind[]) {
      const event = envelope(thread, kind, {});
      expect(classifyNotice(event)).toBeNull();
    }
  });
});
