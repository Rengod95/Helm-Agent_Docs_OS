import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { DialogAsk, DialogAskKey, type AskInputValue } from "@xeon/contracts/capabilities";
import { ApprovalResolvedPayloadSchema, EffectIntentSchema } from "@xeon/contracts/records";
import { createToolRuntime } from "../src/runtime.ts";
import { installDialog } from "./support/fake-dialog.ts";
import {
  callTool,
  createHarness,
  expectOk,
  textOf,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.4: 도구가 `input_required`로 돌아오면 어댑터가 승인 해결을 기다렸다가 같은 입력으로 다시 부른다(L1.tools.spec §4.3, L2.dialog.spec §4.1.2)

const ARGS: { questions: AskInputValue["questions"] } = {
  questions: [
    {
      id: "color",
      question: "Which color?",
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      allowFreeText: false,
    },
  ],
};

function kindsOf(h: Harness, kind: string) {
  return h.session.events.filter((event) => event.kind === kind);
}

test("ask_user_waits_for_the_answer: input_required holds the call until the user answers, then the tool completes once", async () => {
  const h = await createHarness();
  const dialog = installDialog(h);
  const done = callTool(h.runtime.tools, h.run(), { id: "ask_1", name: "ask_user", args: ARGS });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  // 결과는 아직 없다: 의도와 실행 표시만 있고 effect.result는 없다
  expect(kindsOf(h, "effect.intent")).toHaveLength(1);
  expect(kindsOf(h, "effect.exec")).toHaveLength(1);
  expect(kindsOf(h, "effect.result")).toHaveLength(0);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body.kind).toBe("question");
  expect(request?.origin.toolCallId).toBe("ask_1");

  expect(
    await h.runtime.approvals.respond(request?.approvalId ?? "", {
      decision: "answer",
      answer: { color: { selected: ["blue"] } },
    }),
  ).toEqual({ applied: true });
  const out = await done;
  expect(out.blocked).toBeUndefined();
  expect(out.isError).toBe(false);
  expect(textOf(out.result)).toContain("color: 선택: blue");
  // 같은 requestId로 두 번 불렀다: 처음 pending, 두 번째 저장된 답
  expect(dialog.calls.map((call) => call.requestId)).toEqual(["tool:ask_1", "tool:ask_1"]);
  expect(dialog.calls.every((call) => call.wait === false)).toBe(true);
  expect(kindsOf(h, "effect.result")).toHaveLength(1);
  expect(kindsOf(h, "approval.requested")).toHaveLength(1);
  expect(kindsOf(h, "approval.resolved")).toHaveLength(1);
});

test("ask_user_cancelled_with_the_turn: aborting the turn closes the request as cancelled and the call ends as aborted", async () => {
  const h = await createHarness();
  installDialog(h);
  const controller = new AbortController();
  const done = callTool(h.runtime.tools, h.run({ signal: controller.signal }), {
    id: "ask_2",
    name: "ask_user",
    args: ARGS,
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  controller.abort();
  const out = await done;
  expect(textOf(out.result)).toContain("cancelled while waiting for the user");
  const resolved = parse(
    ApprovalResolvedPayloadSchema,
    kindsOf(h, "approval.resolved")[0]?.payload,
  );
  expect(resolved.ok && resolved.value.resolvedBy).toBe("cancelled");
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("ask_user_after_restart: restore plus rerun continues the same request and records one result", async () => {
  const h = await createHarness();
  installDialog(h);
  void callTool(h.runtime.tools, h.run(), { id: "ask_3", name: "ask_user", args: ARGS });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [before] = h.runtime.approvals.pending(h.thread);
  const intentEvent = kindsOf(h, "effect.intent")[0];
  const intent = parse(EffectIntentSchema, intentEvent?.payload);
  if (!intent.ok) throw new Error("intent did not parse");

  // 프로세스가 끝났다. 새 프로세스: 승인 대기를 되살리고 결과 불명 효과를 rerun한다(ask_user는 replay safe)
  const restarted = createToolRuntime(h.deps);
  installDialog(h, restarted);
  expect(expectOk(await restarted.approvals.restore(h.thread))).toHaveLength(1);
  const rerun = restarted.tools.rerun(intent.value, h.run());
  await until(() => restarted.approvals.pending(h.thread).length === 1);
  expect(kindsOf(h, "approval.requested")).toHaveLength(1);
  await restarted.approvals.respond(before?.approvalId ?? "", {
    decision: "answer",
    answer: { color: { selected: ["red"] } },
  });
  const result = expectOk(await rerun);
  expect(result.state).toBe("executed");
  expect(textOf(result.result)).toContain("color: 선택: red");
  expect(kindsOf(h, "effect.result")).toHaveLength(1);
});

test("ask_user_after_the_answer_was_committed: a rerun gets the stored answer without waiting", async () => {
  const h = await createHarness();
  installDialog(h);
  void callTool(h.runtime.tools, h.run(), { id: "ask_4", name: "ask_user", args: ARGS });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "answer",
    answer: { color: { selected: ["red"] } },
  });
  const intent = parse(EffectIntentSchema, kindsOf(h, "effect.intent")[0]?.payload);
  if (!intent.ok) throw new Error("intent did not parse");
  const restarted = createToolRuntime(h.deps);
  installDialog(h, restarted);
  // 이 프로세스는 restore를 부르지 않아도 같은 requestId 요청이 저장된 해결을 읽는다
  const result = expectOk(await restarted.tools.rerun(intent.value, h.run()));
  expect(textOf(result.result)).toContain("color: 선택: red");
  expect(kindsOf(h, "approval.requested")).toHaveLength(1);
});

test("a non-interactive ask is denied at once and the tool reports a dismissed question", async () => {
  const h = await createHarness();
  installDialog(h);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "ask_5",
    name: "ask_user",
    args: ARGS,
  });
  expect(out.blocked).toBeUndefined();
  expect(textOf(out.result)).toContain("사용자가 질문을 닫았다");
  const commit = h.session.commits.find((entry) => entry.kinds.includes("approval.requested"));
  expect(commit?.kinds).toEqual(["approval.requested", "approval.resolved"]);
});

test("a tool waiting for an approval this runtime does not know ends with approval_unknown", async () => {
  const h = await createHarness();
  let calls = 0;
  h.apis.set(DialogAsk.id, {
    ask: () => {
      calls += 1;
      return Promise.resolve({
        status: "input_required",
        approvalId: "evt_00000000000000000000000001",
      });
    },
  });
  h.runtime.tools.register({ kind: "capability", def: DialogAsk, key: DialogAskKey });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "ask_6",
    name: "ask_user",
    args: ARGS,
  });
  expect(textOf(out.result)).toContain("approval_unknown");
  expect(calls).toBe(1);
});

test("a tool that keeps answering input_required for a resolved approval stops after a bounded number of rounds", async () => {
  const h = await createHarness();
  const opened = expectOk(
    await h.runtime.approvals.open({
      origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
      requestKey: "loop-1",
      title: "Question",
      body: {
        kind: "question",
        question: {
          questions: [
            { id: "a", text: "ok?", options: [], multiSelect: false, allowFreeText: true },
          ],
        },
      },
      remember: ["once"],
    }),
  );
  await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "answer",
    answer: { a: { selected: [], text: "yes" } },
  });
  let calls = 0;
  h.apis.set(DialogAsk.id, {
    ask: () => {
      calls += 1;
      return Promise.resolve({ status: "input_required", approvalId: opened.request.approvalId });
    },
  });
  h.runtime.tools.register({ kind: "capability", def: DialogAsk, key: DialogAskKey });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "ask_7",
    name: "ask_user",
    args: ARGS,
  });
  expect(textOf(out.result)).toContain("input_required_loop");
  expect(calls).toBe(8);
});
