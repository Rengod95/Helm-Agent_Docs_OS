import { describe, expect, test } from "bun:test";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import { createStatusService, STATUS_BATCH_MS } from "../src/status/service.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { ThreadId } from "@xeon/contracts/conversation";
import { callOptions, harness, newThread } from "./support/harness.ts";

// 피드의 내구 이벤트와 도구 실행 지점이 내장 세그먼트 core.turn, core.tools, core.usage를 채운다.

const ids = fixedIdFactory(9000);

let seq = 0;
function event(
  threadId: ThreadId,
  kind: EventKind,
  payload: unknown,
  id = ids.next("evt"),
): DurableEventEnvelope {
  seq += 1;
  return {
    id,
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

const USAGE = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1500,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

function requested(thread: ThreadId, kind: "question" | "tool"): unknown {
  const origin = {
    threadId: thread,
    turnId: null,
    stepId: null,
    toolCallId: null,
    caller: "main",
  };
  return {
    origin,
    requestKey: "k",
    title: "t",
    body:
      kind === "question"
        ? {
            kind: "question",
            question: {
              questions: [
                { id: "q", text: "?", options: [], multiSelect: false, allowFreeText: true },
              ],
            },
          }
        : {
            kind: "tool",
            tool: {
              toolName: "bash",
              risk: "exec",
              args: {},
              argsHash: "h",
              ruleId: null,
            },
          },
    remember: ["once"],
    surfaceThreadId: thread,
    requestedAt: 1,
  };
}

async function itemsOf(
  h: ReturnType<typeof harness>,
  api: ReturnType<typeof createStatusService>["api"],
  thread: ThreadId,
) {
  await h.timers.advance(STATUS_BATCH_MS);
  return (await api.list({}, callOptions(thread))).items;
}

describe("내장 세그먼트", () => {
  test("turn.started는 실행 중이고 turn.completed는 대기와 사용량 갱신이다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    status.onEvent(event(thread, "turn.started", {}));
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.turn"),
    ).toMatchObject({
      text: "실행 중",
      tone: "busy",
    });
    status.onEvent(
      event(thread, "turn.completed", {
        status: "completed",
        stepCount: 2,
        usage: USAGE,
        error: null,
      }),
    );
    const items = await itemsOf(h, status.api, thread);
    expect(items.find((item) => item.id === "core.turn")).toMatchObject({ text: "대기" });
    expect(items.find((item) => item.id === "core.usage")).toMatchObject({
      text: "1.5k 토큰 · $0.03",
    });
    status.onEvent(
      event(thread, "turn.completed", {
        status: "completed",
        stepCount: 1,
        usage: USAGE,
        error: null,
      }),
    );
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.usage"),
    ).toMatchObject({
      text: "3.0k 토큰 · $0.06",
    });
  });

  test("approval.requested(question)는 질문 대기, 도구 승인은 승인 대기이고 해결되면 실행 중으로 돌아온다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    status.onEvent(event(thread, "turn.started", {}));
    const questionId = ids.next("evt");
    status.onEvent(event(thread, "approval.requested", requested(thread, "question"), questionId));
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.turn"),
    ).toMatchObject({
      text: "질문 대기",
      tone: "warn",
    });
    status.onEvent(
      event(thread, "approval.resolved", {
        approvalId: questionId,
        decision: "answer",
        answer: null,
        remember: "once",
        requestedRemember: null,
        resolvedBy: "user",
      }),
    );
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.turn"),
    ).toMatchObject({
      text: "실행 중",
    });
    status.onEvent(event(thread, "approval.requested", requested(thread, "tool")));
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.turn"),
    ).toMatchObject({
      text: "승인 대기",
    });
  });

  test("같은 seq의 이벤트는 한 번만 센다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    const done = event(thread, "turn.completed", {
      status: "completed",
      stepCount: 1,
      usage: USAGE,
      error: null,
    });
    status.onEvent(done);
    status.onEvent(done);
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.usage"),
    ).toMatchObject({
      text: "1.5k 토큰 · $0.03",
    });
  });

  test("도구 실행 지점은 core.tools에 이름을 최대 셋까지 싣는다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    for (const [index, name] of ["read", "bash", "grep", "edit", "read"].entries()) {
      status.onToolStart(thread, `call-${index}`, name);
    }
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.tools"),
    ).toMatchObject({
      text: "read, bash, grep +1",
    });
    for (let index = 0; index < 5; index++) status.onToolEnd(thread, `call-${index}`);
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.tools"),
    ).toBeUndefined();
  });

  test("모르는 이벤트는 무시한다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    status.onEvent(event(thread, "item.recorded", {}));
    expect(await itemsOf(h, status.api, thread)).toEqual([]);
  });

  test("깨진 payload는 상태를 망가뜨리지 않는다", async () => {
    const h = harness();
    const status = createStatusService(h.deps);
    const thread = newThread();
    status.onEvent(event(thread, "turn.completed", "garbage"));
    status.onEvent(event(thread, "approval.requested", { body: 1 }));
    status.onEvent(event(thread, "approval.resolved", { approvalId: 1 }));
    expect(
      (await itemsOf(h, status.api, thread)).find((item) => item.id === "core.usage"),
    ).toBeUndefined();
  });
});
