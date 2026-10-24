import { expect, test } from "bun:test";
import {
  McpClient,
  McpClientKey,
  type CallOptions,
  type McpInputRequired,
  type McpQuestion,
  type ReadResourceInputValue,
  type ReadResourceOutputValue,
} from "@xeon/contracts/capabilities";
import type { JsonObject } from "@xeon/contracts/conversation";
import { callTool, createHarness, textOf, until, type Harness } from "./support/harness.ts";

// 결정 D5 (a): 승인 id가 없는 `input_required`(MCP의 `inputRequests`)를 어댑터가 질문 승인(kind question)으로 올리고,
// 답을 `CallOptions.continuation`으로 실어 같은 requestId로 다시 부른다(L1.tools.spec §4.3, L2.mcp.spec §4.6)

const FORM: McpQuestion = {
  key: "ask_name",
  kind: "elicitation_form",
  server: "stub",
  message: "Who are you?",
  requestedSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};

function pendingOutput(round: number, requestState: string | null): McpInputRequired {
  return {
    status: "input_required",
    round,
    inputRequests: { ask_name: { method: "elicitation/create" } },
    requestState,
    questions: [FORM],
  };
}

interface ReadCall {
  readonly requestId: string | undefined;
  readonly continuation: CallOptions["continuation"];
  readonly interactive: boolean | undefined;
}

/** 첫 호출은 input_required, continuation이 오면 받은 응답을 내용으로 돌려주는 MCP 대역 */
function installMcp(
  h: Harness,
  script: (round: number) => ReadResourceOutputValue = (round) =>
    round === 1
      ? pendingOutput(1, "state-1")
      : { status: "complete", contents: [{ type: "text", text: "done" }] },
): ReadCall[] {
  const calls: ReadCall[] = [];
  h.apis.set(McpClient.id, {
    readResource: (
      input: ReadResourceInputValue,
      options?: CallOptions,
    ): Promise<ReadResourceOutputValue> => {
      calls.push({
        requestId: options?.requestId,
        continuation: options?.continuation,
        interactive: options?.context?.interactive,
      });
      void input;
      return Promise.resolve(script(options?.continuation?.round ?? 1));
    },
  });
  h.runtime.tools.register({ kind: "capability", def: McpClient, key: McpClientKey });
  return calls;
}

/** 열려 있는 질문 승인 하나에 자유 답을 보낸다 */
async function answerOpenQuestion(h: Harness, text: string): Promise<void> {
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "answer",
    answer: { q1: { selected: [], text } },
  });
}

const ARGS = { server: "stub", uri: "file:///a" };

function kindsOf(h: Harness, kind: string) {
  return h.session.events.filter((event) => event.kind === kind);
}

test("mcp_input_retried_with_continuation: the question approval carries the form, and the answer returns as inputResponses", async () => {
  const h = await createHarness();
  const calls = installMcp(h);
  const done = callTool(h.runtime.tools, h.run(), {
    id: "mcp_1",
    name: "mcp_read_resource",
    args: ARGS,
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  // 결과는 아직 없다. 의도와 실행 표시는 있고, 대기 체크포인트가 같은 커밋에 있다
  expect(kindsOf(h, "effect.intent")).toHaveLength(1);
  expect(kindsOf(h, "effect.result")).toHaveLength(0);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body.kind).toBe("question");
  expect(request?.origin.toolCallId).toBe("mcp_1");
  expect(request?.requestKey.length).toBeLessThanOrEqual(48);
  if (request?.body.kind !== "question") throw new Error("not a question");
  expect(request.body.question.questions.map((question) => question.text)).toEqual([
    "Who are you?\nname",
  ]);
  const commit = h.session.commits.find((entry) => entry.kinds.includes("approval.requested"));
  expect(commit?.kinds).toContain("checkpoint.step");

  expect(
    await h.runtime.approvals.respond(request.approvalId, {
      decision: "answer",
      answer: { q1: { selected: [], text: "Ada" } },
    }),
  ).toEqual({ applied: true });
  const out = await done;
  expect(out.blocked).toBeUndefined();
  expect(out.isError).toBe(false);
  expect(textOf(out.result)).toContain("done");
  // 같은 requestId로 두 번, 둘째에만 연속 정보가 있다. requestState는 바이트 그대로다
  expect(calls.map((call) => call.requestId)).toEqual(["tool:mcp_1", "tool:mcp_1"]);
  expect(calls[0]?.continuation).toBeUndefined();
  expect(calls[1]?.continuation).toEqual({
    round: 2,
    inputResponses: { ask_name: { action: "accept", content: { name: "Ada" } } },
    requestState: "state-1",
  });
  expect(kindsOf(h, "effect.result")).toHaveLength(1);
});

test("mcp_input_declined: a denied question answers every request with decline and the server finishes", async () => {
  const h = await createHarness();
  const calls = installMcp(h);
  const done = callTool(h.runtime.tools, h.run(), {
    id: "mcp_2",
    name: "mcp_read_resource",
    args: ARGS,
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  const out = await done;
  expect(out.isError).toBe(false);
  expect(calls[1]?.continuation?.inputResponses).toEqual({ ask_name: { action: "decline" } });
});

test("mcp_input_non_interactive: nobody can answer, the request and its denial are one commit, and the server gets decline", async () => {
  const h = await createHarness();
  const calls = installMcp(h);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "mcp_3",
    name: "mcp_read_resource",
    args: ARGS,
  });
  expect(out.isError).toBe(false);
  expect(calls.every((call) => call.interactive === false)).toBe(true);
  expect(calls[1]?.continuation?.inputResponses).toEqual({ ask_name: { action: "decline" } });
  const commit = h.session.commits.find((entry) => entry.kinds.includes("approval.requested"));
  expect(commit?.kinds).toEqual(["approval.requested", "approval.resolved"]);
});

test("mcp_input_cancelled_with_the_turn: aborting while the question is open closes it as cancelled", async () => {
  const h = await createHarness();
  const calls = installMcp(h);
  const controller = new AbortController();
  const done = callTool(h.runtime.tools, h.run({ signal: controller.signal }), {
    id: "mcp_4",
    name: "mcp_read_resource",
    args: ARGS,
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  controller.abort();
  const out = await done;
  expect(textOf(out.result)).toContain("cancelled while waiting for the user");
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  expect(calls).toHaveLength(1);
});

test("mcp_input_second_round: each round is its own question and the round number advances", async () => {
  const h = await createHarness();
  const calls = installMcp(h, (round) =>
    round < 3
      ? pendingOutput(round, `state-${round}`)
      : { status: "complete", contents: [{ type: "text", text: "all done" }] },
  );
  const done = callTool(h.runtime.tools, h.run(), {
    id: "mcp_5",
    name: "mcp_read_resource",
    args: ARGS,
  });
  await answerOpenQuestion(h, "one");
  await answerOpenQuestion(h, "two");
  expect(textOf((await done).result)).toContain("all done");
  expect(calls.map((call) => call.continuation?.round)).toEqual([undefined, 2, 3]);
  const keys = kindsOf(h, "approval.requested").map((event) => event.payload);
  expect(keys).toHaveLength(2);
  const responses: (JsonObject | undefined)[] = calls.map(
    (call) => call.continuation?.inputResponses,
  );
  expect(responses[2]).toEqual({ ask_name: { action: "accept", content: { name: "two" } } });
});

test("mcp_input_malformed: an input_required variant that is neither an approval wait nor an MCP request is an error result", async () => {
  const h = await createHarness();
  h.apis.set(McpClient.id, {
    readResource: () => Promise.resolve({ status: "input_required", round: "x" }),
  });
  h.runtime.tools.register({ kind: "capability", def: McpClient, key: McpClientKey });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "mcp_6",
    name: "mcp_read_resource",
    args: ARGS,
  });
  expect(textOf(out.result)).toContain("input_required_invalid");
});
