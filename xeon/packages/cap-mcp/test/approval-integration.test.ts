import { afterEach, describe, expect, test } from "bun:test";
import { Bug, parse, repeatAsync } from "@xeon/contracts";
import type { McpInputRequired } from "@xeon/contracts/capabilities";
import type { JsonObject, ThreadId } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@xeon/contracts/records";
import type { ApprovalRequest, QuestionAnswer } from "@xeon/contracts/services";
import { fakeApprovals, l2ApprovalsPort } from "@xeon/core-tools/testing";
import { askWithApprovals, buildInputResponses, roundRequestId } from "../src/index.ts";
import type { StubCall, StubOutcome } from "../src/testing/stub-server.ts";
import { startWorld, buildWorld, type World } from "./support/world.ts";

// MCP.4 (E5): 서버 주도 요청이 core-tools의 실제 ApprovalService에 kind `question`으로 기록되고, 응답 뒤 같은 요청이
// `CallOptions.continuation`으로 다시 나간다. 가짜 승인 포트로는 잡지 못하는 body 모양, 요청 키, 멱등 규칙을 실제 서비스로 확인한다.
// 도구 호출 경로(core-tools 어댑터가 `approvalId` 없는 변형을 알아보는 일)는 core-tools 쪽 작업이라 여기서는 어댑터가 할 일을
// 같은 순서로 직접 한다: callTool -> 질문 승인 -> respond -> options.continuation으로 재호출.

const STATE = "opaque state é\u0000 ==/+ ";
const FORM: JsonObject = {
  type: "object",
  properties: { name: { type: "string" }, ok: { type: "boolean" } },
  required: ["name"],
};

function askingTool(seen: StubCall[]) {
  return {
    name: "ask",
    handle: (call: StubCall): StubOutcome => {
      seen.push(call);
      if (call.inputResponses === undefined) {
        return {
          kind: "input_required",
          inputRequests: {
            q1: {
              method: "elicitation/create",
              params: { mode: "form", message: "Who are you?", requestedSchema: FORM },
            },
          },
          requestState: STATE,
        };
      }
      return {
        kind: "complete",
        content: [{ type: "text", text: JSON.stringify(call.inputResponses) }],
      };
    },
  };
}

const worlds: World[] = [];

function worldOf(seen: StubCall[]): World {
  const world = buildWorld({
    servers: { stub: { stub: { era: "modern", tools: [askingTool(seen)] } } },
  });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.runtime.shutdown()));
});

async function setup() {
  const approvals = await fakeApprovals();
  const threadId = approvals.ids.next("thr");
  await approvals.openThread(threadId);
  const port = l2ApprovalsPort(approvals.approvals, { origin: approvals.originOf(threadId) });
  return { approvals, threadId, port };
}

type Approvals = Awaited<ReturnType<typeof setup>>["approvals"];

async function pendingRequest(approvals: Approvals, threadId: ThreadId): Promise<ApprovalRequest> {
  let attempts = 0;
  return await repeatAsync(async () => {
    const [first] = approvals.approvals.pending(threadId);
    if (first !== undefined) return { value: first };
    attempts += 1;
    if (attempts > 400) throw new Bug("no pending approval appeared");
    await Bun.sleep(5);
    return undefined;
  });
}

function eventsOf(approvals: Approvals, kind: string) {
  return approvals.session.events.filter((event) => event.kind === kind);
}

function waitingOutput(
  output: Awaited<ReturnType<World["runtime"]["service"]["client"]["callTool"]>>,
): McpInputRequired {
  if (output.status !== "input_required") throw new Bug("expected input_required");
  return output;
}

/** 모든 질문에 답한 사용자 답: 선택지가 있으면 첫 선택지, 자유 입력이 되면 "Ada" */
function answerOf(request: ApprovalRequest): QuestionAnswer {
  if (request.body.kind !== "question") throw new Bug("expected a question approval");
  const answer: Record<string, { selected: string[]; text?: string }> = {};
  for (const question of request.body.question.questions) {
    const first = question.options[0];
    answer[question.id] = {
      selected: first === undefined ? [] : [first.id],
      ...(first === undefined && question.allowFreeText ? { text: "Ada" } : {}),
    };
  }
  return answer;
}

describe("input_required through the real approval service", () => {
  test("a server request is recorded as one kind question approval and the answer drives round 2", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const client = world.runtime.service.client;

    const first = waitingOutput(
      await client.callTool({ server: "stub", tool: "ask", arguments: { a: 1 } }),
    );
    const requestId = await roundRequestId("tool:call-1", first.round);
    const asking = askWithApprovals(port, {
      threadId,
      questions: first.questions,
      requestId,
      signal: new AbortController().signal,
    });
    const request = await pendingRequest(approvals, threadId);

    // 기록: approval.requested 한 건, kind question, 서버 이름과 질문이 body에 있다
    const requested = eventsOf(approvals, "approval.requested");
    expect(requested).toHaveLength(1);
    const payload = parse(ApprovalRequestedPayloadSchema, requested[0]?.payload);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.value.body.kind).toBe("question");
    expect(payload.value.remember).toEqual(["once"]);
    expect(payload.value.surfaceThreadId).toBe(threadId);
    expect(
      request.body.kind === "question" ? request.body.question.questions.length : 0,
    ).toBeGreaterThan(0);

    const answer = answerOf(request);
    expect(
      await approvals.approvals.respond(request.approvalId, { decision: "answer", answer }),
    ).toEqual({
      applied: true,
    });
    const responses = await asking;
    expect(responses.ok).toBe(true);
    if (!responses.ok) return;
    expect(responses.value["q1"]).toMatchObject({ action: "accept" });

    const resolved = parse(
      ApprovalResolvedPayloadSchema,
      eventsOf(approvals, "approval.resolved")[0]?.payload,
    );
    expect(resolved.ok && resolved.value.decision).toBe("answer");

    // 재호출: 어댑터는 입력을 건드리지 않고 옵션으로 연속 정보를 싣는다
    const second = await client.callTool(
      { server: "stub", tool: "ask", arguments: { a: 1 } },
      {
        requestId: "tool:call-1",
        continuation: {
          round: first.round + 1,
          inputResponses: responses.value,
          requestState: first.requestState,
        },
      },
    );
    expect(second.status).toBe("complete");
    expect(seen).toHaveLength(2);
    expect(seen[1]?.requestState).toBe(STATE);
    expect(seen[1]?.arguments).toEqual({ a: 1 });
    expect(seen[1]?.inputResponses).toEqual(responses.value);
  });

  test("the same request id after the answer reads the stored resolution and opens no second approval", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const first = waitingOutput(
      await world.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const input = {
      threadId,
      questions: first.questions,
      requestId: await roundRequestId("tool:call-2", first.round),
      signal: new AbortController().signal,
    };
    const asking = askWithApprovals(port, input);
    const request = await pendingRequest(approvals, threadId);
    await approvals.approvals.respond(request.approvalId, {
      decision: "answer",
      answer: answerOf(request),
    });
    const before = await asking;

    // 프로세스가 다시 떠서 같은 라운드를 다시 묻는 경우: 저장된 해결을 읽고 대기하지 않는다
    const again = await askWithApprovals(port, input);
    expect(again).toEqual(before);
    expect(eventsOf(approvals, "approval.requested")).toHaveLength(1);
    expect(eventsOf(approvals, "approval.resolved")).toHaveLength(1);
    // 서버에는 라운드 1만 나갔다. 라운드 2는 승인 해결 뒤 한 번만 나간다
    expect(seen.filter((call) => call.inputResponses !== undefined)).toHaveLength(0);
  });

  test("deny becomes a decline response and the server still completes", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const client = world.runtime.service.client;
    const first = waitingOutput(
      await client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const asking = askWithApprovals(port, {
      threadId,
      questions: first.questions,
      requestId: await roundRequestId("tool:call-3", first.round),
      signal: new AbortController().signal,
    });
    const request = await pendingRequest(approvals, threadId);
    // 거부의 정본 answer 모양은 { feedback }이다
    await approvals.approvals.respond(request.approvalId, {
      decision: "deny",
      answer: { feedback: "no thanks" },
    });
    const responses = await asking;
    expect(responses).toEqual({ ok: true, value: { q1: { action: "decline" } } });
    if (!responses.ok) return;
    const second = await client.callTool(
      { server: "stub", tool: "ask", arguments: {} },
      {
        continuation: {
          round: 2,
          inputResponses: responses.value,
          requestState: first.requestState,
        },
      },
    );
    expect(second.status).toBe("complete");
    expect(seen[1]?.inputResponses).toEqual({ q1: { action: "decline" } });
  });

  test("aborting the wait ends the ask without a response", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const first = waitingOutput(
      await world.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const controller = new AbortController();
    const asking = askWithApprovals(port, {
      threadId,
      questions: first.questions,
      requestId: await roundRequestId("tool:call-4", first.round),
      signal: controller.signal,
    });
    await pendingRequest(approvals, threadId);
    controller.abort();
    expect(await asking).toEqual({ ok: false, error: { kind: "wait_cancelled" } });
  });

  test("a wrong answer shape is refused by the service and the request stays pending", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const first = waitingOutput(
      await world.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const asking = askWithApprovals(port, {
      threadId,
      questions: first.questions,
      requestId: await roundRequestId("tool:call-5", first.round),
      signal: new AbortController().signal,
    });
    const request = await pendingRequest(approvals, threadId);
    // question 요청에 allow는 맞지 않는 조합이다(L1.tools.spec §3.6). 해결되지 않는다
    expect(await approvals.approvals.respond(request.approvalId, { decision: "allow" })).toEqual({
      applied: false,
      reason: "answer_invalid",
      detail: 'decision "allow" does not fit this request',
    });
    expect(approvals.approvals.pending(threadId)).toHaveLength(1);
    await approvals.approvals.respond(request.approvalId, {
      decision: "answer",
      answer: answerOf(request),
    });
    expect((await asking).ok).toBe(true);
    const built = buildInputResponses(first.questions, [{ key: "q1", action: "decline" }]);
    expect(built.ok).toBe(true);
  });
});

describe("record shape (E5)", () => {
  test("an MCP question, the question tool and a plan approval share one approval.requested record shape", async () => {
    const seen: StubCall[] = [];
    const world = worldOf(seen);
    await startWorld(world);
    const { approvals, threadId, port } = await setup();
    const first = waitingOutput(
      await world.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const signal = new AbortController().signal;
    void askWithApprovals(port, {
      threadId,
      questions: first.questions,
      requestId: "mcp-shape#r1",
      signal,
    });
    // 질문 도구(cap-dialog `ask`)가 올리는 모양: header와 recommended를 쓴 질문
    const asked = await port.request({
      threadId,
      kind: "question",
      subject: {
        questions: [
          {
            id: "color",
            header: "Color",
            text: "Which color?",
            options: [{ id: "red", label: "Red", recommended: true }],
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      },
      requestId: "ask-shape",
    });
    const planned = await port.request({
      threadId,
      kind: "plan",
      subject: { plan: "# Plan", planRef: null, nextModes: ["default"] },
      requestId: "plan-shape",
    });
    expect(asked.ok && planned.ok).toBe(true);

    const events = eventsOf(approvals, "approval.requested");
    expect(events).toHaveLength(3);
    const payloads = events.map((event) => parse(ApprovalRequestedPayloadSchema, event.payload));
    for (const payload of payloads) expect(payload.ok).toBe(true);
    const values = payloads.flatMap((payload) => (payload.ok ? [payload.value] : []));
    expect(values.map((value) => value.body.kind)).toEqual(["question", "question", "plan"]);

    // 이벤트 봉투와 payload의 키, 출처, 기억 범위, 기록 대화가 모두 같다
    const shapeOf = (index: number) => {
      const event = events[index];
      const value = values[index];
      return {
        kind: event?.kind,
        version: event?.version,
        durable: event?.durable,
        payloadKeys: Object.keys(event?.payload ?? {}).toSorted(),
        originKeys: Object.keys(value?.origin ?? {}).toSorted(),
        bodyKeys: Object.keys(value?.body ?? {}).toSorted(),
        remember: value?.remember,
        surface: value?.surfaceThreadId,
      };
    };
    const [mcp, tool, plan] = [shapeOf(0), shapeOf(1), shapeOf(2)];
    expect(mcp).toEqual({ ...tool, bodyKeys: mcp.bodyKeys });
    expect(mcp.bodyKeys).toEqual(["kind", "question"]);
    expect(plan.payloadKeys).toEqual(mcp.payloadKeys);
    expect(plan.originKeys).toEqual(mcp.originKeys);
    expect(plan.remember).toEqual(mcp.remember);

    // 질문 항목: 필수 키는 질문 도구와 같고, MCP가 올리는 항목에는 질문 도구 전용 키(header, recommended)가 없다
    const body = (index: number) => {
      const value = values[index]?.body;
      return value?.kind === "question" ? value.question.questions : [];
    };
    const required = ["allowFreeText", "id", "multiSelect", "options", "text"];
    for (const item of body(0)) {
      expect(Object.keys(item).toSorted()).toEqual(required);
      for (const option of item.options)
        expect(Object.keys(option).toSorted()).toEqual(["id", "label"]);
    }
    expect(Object.keys(body(1)[0] ?? {}).toSorted()).toEqual(["header", ...required].toSorted());
  });
});
