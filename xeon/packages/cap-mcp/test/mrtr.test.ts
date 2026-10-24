import { describe, expect, test } from "bun:test";
import { parse, parseJson } from "@xeon/contracts";
import {
  CallToolOutput,
  type CallToolOutputValue,
  type McpContinuation,
  type McpInputRequired,
} from "@xeon/contracts/capabilities";
import type { JsonObject } from "@xeon/contracts/conversation";
import {
  askWithApprovals,
  buildInputResponses,
  decodeAnswer,
  planQuestionBody,
  roundRequestId,
} from "../src/index.ts";
import { SECRET_FIELD_WARNING } from "../src/elicitation/questions.ts";
import type { StubCall, StubOutcome } from "../src/testing/stub-server.ts";
import { fakeApprovals, testThreadId } from "./support/approvals.ts";
import { rejection } from "./support/rejection.ts";
import { buildWorld, startWorld, type World } from "./support/world.ts";

const STATE = "opaque state é\u0000 ==/+ ";
const FORM: JsonObject = {
  type: "object",
  properties: { name: { type: "string" }, ok: { type: "boolean" } },
  required: ["name"],
};

function askRequest(requestedSchema: JsonObject = FORM): JsonObject {
  return {
    q1: {
      method: "elicitation/create",
      params: { mode: "form", message: "Who are you?", requestedSchema },
    },
  };
}

/** 라운드 1은 입력을 요구하고, 응답이 붙은 라운드 2는 받은 값을 되돌려 준다 */
function askingTool(seen: StubCall[], requestedSchema?: JsonObject) {
  return {
    name: "ask",
    handle: (call: StubCall): StubOutcome => {
      seen.push(call);
      if (call.inputResponses === undefined) {
        return {
          kind: "input_required",
          inputRequests: askRequest(requestedSchema),
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

function world(tool: ReturnType<typeof askingTool>, user: Record<string, unknown> = {}): World {
  return buildWorld({ servers: { stub: { stub: { era: "modern", tools: [tool] } } }, user });
}

function inputRequired(output: CallToolOutputValue): McpInputRequired {
  if (output.status !== "input_required") throw new Error("expected input_required");
  return output;
}

describe("input_required", () => {
  test("input_required becomes approval request", async () => {
    const seen: StubCall[] = [];
    const w = world(askingTool(seen));
    await startWorld(w);
    const output = inputRequired(
      await w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    expect(output.round).toBe(1);
    expect(output.requestState).toBe(STATE);
    expect(output.questions).toHaveLength(1);
    expect(output.questions[0]).toMatchObject({
      kind: "elicitation_form",
      server: "stub",
      key: "q1",
    });

    // 그룹 코드 경로: 질문을 kind question 승인으로 올린다
    const approvals = fakeApprovals();
    const asking = askWithApprovals(approvals, {
      threadId: testThreadId(),
      questions: output.questions,
      requestId: "call-1#r1",
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    expect(approvals.requests).toHaveLength(1);
    expect(approvals.requests[0]?.kind).toBe("question");
    approvals.resolveLast("answer", {
      q1: { selected: [], text: "Ada" },
      q2: { selected: ["yes"] },
    });
    const responses = await asking;
    expect(responses.ok).toBe(true);
    await w.runtime.shutdown();
  });

  test("retry carries responses and state", async () => {
    const seen: StubCall[] = [];
    const w = world(askingTool(seen));
    await startWorld(w);
    const first = inputRequired(
      await w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: { a: 1 } }),
    );
    const responses = buildInputResponses(first.questions, [
      { key: "q1", action: "accept", content: { name: "Ada", ok: true } },
    ]);
    expect(responses.ok).toBe(true);
    if (!responses.ok) return;
    const continuation: McpContinuation = {
      round: first.round + 1,
      inputResponses: responses.value,
      requestState: first.requestState,
    };
    const second = await w.runtime.service.client.callTool({
      server: "stub",
      tool: "ask",
      arguments: { a: 1 },
      continuation,
    });
    // 라운드 2 요청에 응답과 requestState가 바이트 그대로 실렸다
    expect(seen).toHaveLength(2);
    expect(seen[1]?.requestState).toBe(STATE);
    expect(seen[1]?.inputResponses).toEqual({
      q1: { action: "accept", content: { name: "Ada", ok: true } },
    });
    expect(seen[1]?.arguments).toEqual({ a: 1 });
    expect(second.status).toBe("complete");
    await w.runtime.shutdown();
  });

  test("CallOptions.continuation carries the retry and wins over the input field (F request 12)", async () => {
    const seen: StubCall[] = [];
    const w = world(askingTool(seen));
    await startWorld(w);
    const first = inputRequired(
      await w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const responses = buildInputResponses(first.questions, [
      { key: "q1", action: "accept", content: { name: "Grace" } },
    ]);
    if (!responses.ok) throw new Error("responses failed");
    // L1.tools 어댑터는 입력을 건드리지 않고 옵션으로 연속 정보를 싣는다
    const second = await w.runtime.service.client.callTool(
      { server: "stub", tool: "ask", arguments: {} },
      {
        requestId: "call-opt",
        continuation: {
          round: 2,
          inputResponses: responses.value,
          requestState: first.requestState,
        },
      },
    );
    expect(seen[1]?.requestState).toBe(STATE);
    expect(seen[1]?.inputResponses).toEqual({
      q1: { action: "accept", content: { name: "Grace" } },
    });
    expect(second.status).toBe("complete");
    await w.runtime.shutdown();
  });

  test("completes after retry", async () => {
    const w = world(askingTool([]));
    await startWorld(w);
    await w.runtime.applyBoundary();
    const tool = w.registrar.registered[0];
    const signal = new AbortController().signal;
    const pending = await tool?.execute({}, { signal, requestId: "call-1" });
    expect(pending?.status).toBe("input_required");
    expect(pending?.inputRequired).toMatchObject({ requestState: STATE });
    expect(pending?.isError).toBeUndefined();
    const done = await tool?.execute(
      {},
      {
        signal,
        requestId: "call-1",
        continuation: {
          round: 2,
          inputResponses: { q1: { action: "decline" } },
          requestState: STATE,
        },
      },
    );
    expect(done?.status).toBe("complete");
    const text = done?.content[0];
    expect(text?.type === "text" ? text.text : "").toContain("decline");
    await w.runtime.shutdown();
  });

  test("rounds exceeded", async () => {
    const endless = {
      name: "ask",
      handle: (): StubOutcome => ({
        kind: "input_required",
        inputRequests: askRequest(),
        requestState: "s",
      }),
    };
    const w = world(endless, { "inputRequired.maxRounds": 2 });
    await startWorld(w);
    const client = w.runtime.service.client;
    const first = inputRequired(
      await client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    expect(first.round).toBe(1);
    const second = await rejection(
      client.callTool({
        server: "stub",
        tool: "ask",
        arguments: {},
        continuation: { round: 2, inputResponses: {}, requestState: "s" },
      }),
    );
    // 라운드 2의 응답이 또 입력을 요구하면 상한(2)을 넘으므로 오류다
    expect(second).toMatchObject({ data: { code: "input_rounds_exceeded" } });
    const third = await rejection(
      client.callTool({
        server: "stub",
        tool: "ask",
        arguments: {},
        continuation: { round: 3, inputResponses: {}, requestState: "s" },
      }),
    );
    expect(third).toMatchObject({ data: { code: "input_rounds_exceeded" } });
    await w.runtime.shutdown();
  });

  test("request id per round", async () => {
    expect(await roundRequestId("call-1", 2)).toBe("call-1#r2");
    const long = "x".repeat(70);
    const short = await roundRequestId(long, 12);
    expect(short.length).toBeLessThanOrEqual(64);
    expect(short.endsWith("#r12")).toBe(true);
    expect(await roundRequestId(long, 12)).toBe(short);
    expect(await roundRequestId(long, 13)).not.toBe(short);
  });

  test("restart while waiting retries once", async () => {
    const seen: StubCall[] = [];
    const before = world(askingTool(seen));
    await startWorld(before);
    const pending = inputRequired(
      await before.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    // 대기 상태는 내구 기록(JSON)에만 남는다. 프로세스가 끝나고 새 인스턴스가 이어받는다
    const restored = parseJson(JSON.stringify(pending));
    const durable = parse(CallToolOutput, restored.ok ? restored.value : null);
    if (!durable.ok || durable.value.status !== "input_required")
      throw new Error("durable state is invalid");
    const waiting = durable.value;
    await before.runtime.shutdown();

    const after = world(askingTool(seen));
    await startWorld(after);
    const responses = buildInputResponses(waiting.questions, [
      { key: "q1", action: "accept", content: { name: "Ada" } },
    ]);
    expect(responses.ok).toBe(true);
    if (!responses.ok) return;
    const result = await after.runtime.service.client.callTool({
      server: "stub",
      tool: "ask",
      arguments: {},
      continuation: {
        round: waiting.round + 1,
        inputResponses: responses.value,
        requestState: waiting.requestState,
      },
    });
    expect(result.status).toBe("complete");
    // 라운드 2 요청은 정확히 한 번 나갔다
    expect(seen.filter((call) => call.inputResponses !== undefined)).toHaveLength(1);
    expect(seen[1]?.requestState).toBe(STATE);
    await after.runtime.shutdown();
  });

  test("undeclared input kind rejected", async () => {
    const sampling = {
      name: "ask",
      handle: (): StubOutcome => ({
        kind: "input_required",
        inputRequests: { s1: { method: "sampling/createMessage", params: { messages: [] } } },
        requestState: "s",
      }),
    };
    const w = world(sampling);
    await startWorld(w);
    const failure = await rejection(
      w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    expect(failure).toMatchObject({ data: { code: "input_unsupported" } });
    await w.runtime.shutdown();

    // sampling을 "ask"로 두면 질문으로 보이지만 응답은 보내지 않는다(미결 6)
    const asking = world(sampling, { sampling: "ask" });
    await startWorld(asking);
    const output = inputRequired(
      await asking.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    expect(output.questions[0]?.kind).toBe("sampling");
    const responses = buildInputResponses(output.questions, []);
    expect(responses).toEqual({ ok: true, value: {} });
    await asking.runtime.shutdown();
  });

  test("secret-like form field warns", async () => {
    const schema: JsonObject = { type: "object", properties: { api_key: { type: "string" } } };
    const w = world(askingTool([], schema));
    await startWorld(w);
    const output = inputRequired(
      await w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const question = output.questions[0];
    expect(question?.kind === "elicitation_form" ? question.message : "").toContain(
      SECRET_FIELD_WARNING,
    );
    await w.runtime.shutdown();
  });

  test("decline response", async () => {
    const seen: StubCall[] = [];
    const w = world(askingTool(seen));
    await startWorld(w);
    const first = inputRequired(
      await w.runtime.service.client.callTool({ server: "stub", tool: "ask", arguments: {} }),
    );
    const responses = buildInputResponses(first.questions, [{ key: "q1", action: "decline" }]);
    expect(responses).toEqual({ ok: true, value: { q1: { action: "decline" } } });
    if (!responses.ok) return;
    await w.runtime.service.client.callTool({
      server: "stub",
      tool: "ask",
      arguments: {},
      continuation: { round: 2, inputResponses: responses.value, requestState: first.requestState },
    });
    expect(seen[1]?.inputResponses).toEqual({ q1: { action: "decline" } });
    await w.runtime.shutdown();
  });

  test("invalid form content is rejected before sending", () => {
    const planned = buildInputResponses(
      [
        {
          key: "q1",
          kind: "elicitation_form",
          server: "stub",
          message: "m",
          requestedSchema: FORM,
        },
      ],
      [{ key: "q1", action: "accept", content: { ok: "yes" } }],
    );
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.error).toMatchObject({ kind: "invalid_content", key: "q1" });
    const unknown = buildInputResponses([], [{ key: "zz", action: "decline" }]);
    expect(unknown).toEqual({ ok: false, error: { kind: "unknown_key", key: "zz" } });
  });

  test("approval answers become input responses", () => {
    const questions = inputRequiredQuestions();
    const planned = planQuestionBody(questions);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const ids = [...planned.value.targets.keys()];
    expect(ids).toEqual(["q1", "q2"]);
    const decoded = decodeAnswer(planned.value, {
      q1: { selected: [], text: "Ada" },
      q2: { selected: ["yes"] },
    });
    expect(decoded).toEqual({
      ok: true,
      value: { q1: { action: "accept", content: { name: "Ada", ok: true } } },
    });
  });

  test("approval flow: deny, cancel, too many questions, request failure", async () => {
    const questions = inputRequiredQuestions();
    const signal = new AbortController().signal;
    const thread = testThreadId();

    const denied = fakeApprovals();
    const pending = askWithApprovals(denied, {
      threadId: thread,
      questions,
      requestId: "r1",
      signal,
    });
    await Promise.resolve();
    denied.resolveLast("deny");
    expect(await pending).toEqual({ ok: true, value: { q1: { action: "decline" } } });

    const cancelled = fakeApprovals();
    const cancelling = askWithApprovals(cancelled, {
      threadId: thread,
      questions,
      requestId: "r1",
      signal,
    });
    await Promise.resolve();
    cancelled.cancelLast();
    expect(await cancelling).toEqual({ ok: true, value: { q1: { action: "cancel" } } });

    // 같은 requestId로 다시 부르면 저장된 해결을 읽는다(재개 뒤 경로)
    const resumed = fakeApprovals();
    const first = askWithApprovals(resumed, {
      threadId: thread,
      questions,
      requestId: "r2",
      signal,
    });
    await Promise.resolve();
    resumed.resolveLast("answer", { q1: { selected: [], text: "Ada" } });
    await first;
    const again = await askWithApprovals(resumed, {
      threadId: thread,
      questions,
      requestId: "r2",
      signal,
    });
    expect(again).toEqual({
      ok: true,
      value: { q1: { action: "accept", content: { name: "Ada" } } },
    });
    expect(resumed.requests).toHaveLength(1);

    const many = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`,
      kind: "elicitation_url" as const,
      server: "stub",
      message: "m",
      url: "https://example.com",
    }));
    const tooMany = await askWithApprovals(fakeApprovals(), {
      threadId: thread,
      questions: many,
      requestId: "r3",
      signal,
    });
    expect(tooMany).toEqual({ ok: false, error: { kind: "too_many_questions", count: 5 } });

    const broken = fakeApprovals();
    broken.failNext({ kind: "rejected", code: "approvals.request_invalid", detail: null });
    const failed = await askWithApprovals(broken, {
      threadId: thread,
      questions,
      requestId: "r4",
      signal,
    });
    expect(failed).toMatchObject({ ok: false, error: { kind: "request_failed" } });
  });

  test("a 2025 server elicitation request is declined", async () => {
    const w = buildWorld({
      servers: { stub: { stub: { era: "legacy", tools: [{ name: "x" }] } } },
    });
    await startWorld(w);
    const reply = await w.stubs["stub"]?.serverRequest("elicitation/create", {
      message: "hi",
      requestedSchema: { type: "object", properties: {} },
    });
    // 수동 모드에는 처리기가 없어 요청은 거절된다(L2.mcp.spec §5 13번)
    expect(reply?.kind).toBe("error");
    await w.runtime.shutdown();
  });
});

function inputRequiredQuestions(): McpInputRequired["questions"] {
  return [
    { key: "q1", kind: "elicitation_form", server: "stub", message: "Who?", requestedSchema: FORM },
  ];
}
