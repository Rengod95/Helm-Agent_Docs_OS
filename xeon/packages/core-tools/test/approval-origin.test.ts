import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { ApprovalRequestedPayloadSchema } from "@xeon/contracts/records";
import type { ApprovalBody, ApprovalRequestInput } from "@xeon/contracts/services";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// 통합 검토 M1(M2 마감 G1-09). 능력 어댑터는 CallContext에서 origin을 만들어 stepId가 없다. 승인 서비스가 활성 호출에서 채운다.

const QUESTION: ApprovalBody = {
  kind: "question",
  question: {
    questions: [
      { id: "note", text: "Anything?", options: [], multiSelect: false, allowFreeText: true },
    ],
  },
};

function requestedPayloads(h: Harness) {
  return h.session.events
    .filter((event) => event.kind === "approval.requested")
    .map((event) => {
      const parsed = parse(ApprovalRequestedPayloadSchema, event.payload);
      if (!parsed.ok) throw new Error("approval.requested payload is not valid");
      return { event, payload: parsed.value };
    });
}

test("an origin without stepId gets the active call's step: payload origin and event envelope agree", async () => {
  const h = await createHarness();
  const run = h.run();
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "core.test",
      tool: directTool(
        "ask_like_a_capability",
        async (toolCallId, _params, signal) => {
          const input: ApprovalRequestInput = {
            // cap-dialog 같은 어댑터가 CallContext로 만든 origin: stepId를 모른다
            origin: {
              threadId: h.thread,
              turnId: run.turnId,
              stepId: null,
              toolCallId,
              caller: "main",
            },
            requestKey: "ask-1",
            title: "Ask",
            body: QUESTION,
            remember: ["once"],
          };
          await h.runtime.approvals.request(input, signal);
          return { content: [{ type: "text", text: "done" }], details: null };
        },
        { replay: "safe" },
      ),
      policy: { risk: "read" },
    }),
  );
  const done = callTool(h.runtime.tools, run, {
    id: "call_o1",
    name: "ask_like_a_capability",
    args: {},
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.origin.stepId).toBe(run.stepId);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "answer",
    answer: { note: { selected: [], text: "x" } },
  });
  await done;
  const [stored] = requestedPayloads(h);
  expect(stored?.payload.origin).toMatchObject({
    threadId: h.thread,
    turnId: run.turnId,
    stepId: run.stepId,
    toolCallId: "call_o1",
  });
  expect(stored?.event.stepId).toBe(run.stepId);
  expect(stored?.event.turnId).toBe(run.turnId);
});

test("a policy approval records the call's turn, step, tool call and caller as values", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const done = callTool(h.runtime.tools, run, {
    id: "call_o2",
    name: "bash",
    args: { command: "echo hi" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  await done;
  const [stored] = requestedPayloads(h);
  expect(stored?.payload.origin).toEqual({
    threadId: h.thread,
    turnId: run.turnId,
    stepId: run.stepId,
    toolCallId: "call_o2",
    caller: "main",
  });
});

test("a subagent policy approval records the definition name in the caller", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run({ caller: "subagent:reviewer" });
  const done = callTool(h.runtime.tools, run, {
    id: "call_o3",
    name: "bash",
    args: { command: "echo hi" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  await done;
  expect(requestedPayloads(h)[0]?.payload.origin.caller).toBe("subagent:reviewer");
});
