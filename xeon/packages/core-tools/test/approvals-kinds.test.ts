import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  EffectIntentSchema,
  StepCheckpointSchema,
} from "@xeon/contracts/records";
import type {
  ApprovalBody,
  ApprovalRequest,
  ApprovalResolution,
  ApprovalRequestInput,
} from "@xeon/contracts/services";
import { createToolRuntime } from "../src/runtime.ts";
import { eachInOrder } from "../src/util.ts";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  layer,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.4: 질문(question)과 계획(plan) 승인이 도구 승인과 같은 approval.requested 레코드로 기록된다(TL-12)

const QUESTION: ApprovalBody = {
  kind: "question",
  question: {
    questions: [
      {
        id: "color",
        text: "Which color?",
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
      { id: "note", text: "Anything else?", options: [], multiSelect: false, allowFreeText: true },
    ],
  },
};

const PLAN: ApprovalBody = {
  kind: "plan",
  plan: { plan: "# Plan\n1. do it", planRef: null, nextModes: ["default", "acceptEdits"] },
};

interface Asker {
  /** 도구 이름 */
  readonly name: string;
  readonly resolutions: ApprovalResolution[];
}

/** 질문·계획 도구: 실행 안에서 xeon.approvals.request를 부르고 해결이 오면 끝난다 */
function registerAsker(
  h: Harness,
  name: string,
  body: ApprovalBody,
  requestKey: string,
  runtime: {
    approvals: Harness["runtime"]["approvals"];
    tools: Harness["runtime"]["tools"];
  } = h.runtime,
): Asker {
  const resolutions: ApprovalResolution[] = [];
  expectOk(
    runtime.tools.register({
      kind: "direct",
      orderKey: "core.test",
      tool: directTool(
        name,
        async (toolCallId, _params, signal) => {
          const run = h.run();
          const input: ApprovalRequestInput = {
            origin: {
              threadId: h.thread,
              turnId: run.turnId,
              stepId: run.stepId,
              toolCallId,
              caller: "main",
            },
            requestKey,
            title: `Ask ${name}`,
            body,
            remember: ["once"],
          };
          const answered = await runtime.approvals.request(input, signal);
          if (!answered.ok) {
            return {
              content: [{ type: "text", text: `failed: ${answered.error.kind}` }],
              details: null,
              isError: true,
            };
          }
          resolutions.push(answered.value);
          return {
            content: [{ type: "text", text: answered.value.decision }],
            details: null,
          };
        },
        { replay: "safe" },
      ),
      policy: { risk: "read" },
    }),
  );
  return { name, resolutions };
}

function pendingOf(h: Harness): ApprovalRequest {
  const [request] = h.runtime.approvals.pending(h.thread);
  if (request === undefined) throw new Error("no pending approval");
  return request;
}

test("question_and_plan_approval_share_request_shape: both are approval.requested with the same envelope and only body.kind differs", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-1");
  registerAsker(h, "submit_plan", PLAN, "p-1");
  const question = callTool(h.runtime.tools, h.run(), { id: "call_q", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const plan = callTool(h.runtime.tools, h.run(), { id: "call_p", name: "submit_plan", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 2);

  const requested = h.session.events.filter((event) => event.kind === "approval.requested");
  expect(requested).toHaveLength(2);
  const parsed = requested.map((event) => parse(ApprovalRequestedPayloadSchema, event.payload));
  expect(parsed.every((entry) => entry.ok)).toBe(true);
  const bodies = parsed.map((entry) => (entry.ok ? entry.value.body.kind : "invalid"));
  expect(bodies).toEqual(["question", "plan"]);
  const [first, second] = parsed;
  if (first?.ok !== true || second?.ok !== true) throw new Error("payload did not parse");
  expect(Object.keys(first.value).toSorted()).toEqual(Object.keys(second.value).toSorted());
  expect(first.value.remember).toEqual(["once"]);

  // 응답이 오면 두 도구 모두 끝난다
  const [q, p] = h.runtime.approvals.pending(h.thread);
  expect(
    await h.runtime.approvals.respond(q?.approvalId ?? "", {
      decision: "answer",
      answer: { color: { selected: ["red"] }, note: { selected: [], text: "no" } },
    }),
  ).toEqual({ applied: true });
  expect(await h.runtime.approvals.respond(p?.approvalId ?? "", { decision: "allow" })).toEqual({
    applied: true,
  });
  expect((await question).blocked).toBeUndefined();
  expect((await plan).blocked).toBeUndefined();
  const resolved = h.session.events
    .filter((event) => event.kind === "approval.resolved")
    .map((event) => parse(ApprovalResolvedPayloadSchema, event.payload));
  expect(resolved.map((entry) => (entry.ok ? entry.value.decision : "invalid"))).toEqual([
    "answer",
    "allow",
  ]);
});

test("a request from a running tool writes the waiting checkpoint with the call's effect id in the same commit", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-2");
  const done = callTool(h.runtime.tools, h.run(), { id: "call_w", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const commit = h.session.commits.find((entry) => entry.kinds.includes("approval.requested"));
  expect(commit?.kinds).toEqual(["approval.requested", "checkpoint.step"]);
  const intent = h.session.events.find((event) => event.kind === "effect.intent");
  const checkpoint = h.session.events.find((event) => event.kind === "checkpoint.step");
  const parsed = parse(StepCheckpointSchema, checkpoint?.payload);
  expect(parsed.ok && parsed.value.next).toBe("await_input");
  const intentPayload = parse(EffectIntentSchema, intent?.payload);
  expect(intentPayload.ok).toBe(true);
  expect(parsed.ok && parsed.value.pendingToolCalls).toEqual([
    {
      toolCallId: "call_w",
      effectId: intentPayload.ok ? intentPayload.value.effectId : null,
      waiting: "approval",
    },
  ]);
  await h.runtime.approvals.respond(pendingOf(h).approvalId, { decision: "deny" });
  await done;
});

test("question answers are checked against the questions: unknown ids, bad options, empty answers and wrong decisions are not applied", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-3");
  const done = callTool(h.runtime.tools, h.run(), { id: "call_a", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const id = pendingOf(h).approvalId;
  const bad = [
    { decision: "allow" as const },
    { decision: "answer" as const },
    { decision: "answer" as const, answer: { color: { selected: ["green"] } } },
    {
      decision: "answer" as const,
      answer: { color: { selected: ["red", "blue"] }, note: { selected: [], text: "x" } },
    },
    { decision: "answer" as const, answer: { color: { selected: ["red"] } } },
    {
      decision: "answer" as const,
      answer: { color: { selected: [], text: "free" }, note: { selected: [], text: "x" } },
    },
    {
      decision: "answer" as const,
      answer: { color: { selected: ["red"] }, note: { selected: [] }, extra: { selected: [] } },
    },
    {
      decision: "answer" as const,
      answer: { color: { selected: ["red"] }, note: { selected: [], text: "x" } },
      remember: "thread" as const,
    },
  ];
  await eachInOrder(bad, async (response) => {
    expect(await h.runtime.approvals.respond(id, response)).toEqual({ applied: false });
  });
  expect(h.session.events.some((event) => event.kind === "approval.resolved")).toBe(false);
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  // deny는 어느 질문에도 허용되고 feedback만 남긴다
  expect(
    await h.runtime.approvals.respond(id, {
      decision: "deny",
      answer: { feedback: "later", x: 1 },
    }),
  ).toEqual({ applied: true });
  await done;
  const resolved = parse(
    ApprovalResolvedPayloadSchema,
    h.session.events.find((event) => event.kind === "approval.resolved")?.payload,
  );
  expect(resolved.ok && resolved.value.answer).toEqual({ feedback: "later" });
});

test("plan_approval_switches_mode: allow with a mode writes the session mode before the plan tool continues", async () => {
  const h = await createHarness({ layers: [layer("user", { "l1.tools.permissionMode": "plan" })] });
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");
  const asker = registerAsker(h, "submit_plan", PLAN, "p-2");
  const modeWhenResolved: string[] = [];
  const done = callTool(h.runtime.tools, h.run(), { id: "call_m", name: "submit_plan", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const id = pendingOf(h).approvalId;
  // 허용 목록 밖의 모드와 질문용 decision은 적용되지 않는다
  expect(
    await h.runtime.approvals.respond(id, { decision: "allow", answer: { mode: "bypass" } }),
  ).toEqual({ applied: false });
  expect(await h.runtime.approvals.respond(id, { decision: "answer" })).toEqual({ applied: false });
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");
  expect(
    await h.runtime.approvals.respond(id, { decision: "allow", answer: { mode: "acceptEdits" } }),
  ).toEqual({ applied: true });
  await done;
  modeWhenResolved.push(h.runtime.tools.mode(h.thread));
  expect(modeWhenResolved).toEqual(["acceptEdits"]);
  expect(h.session.sessionValues(h.thread).get("l1.tools.permissionMode")).toBe("acceptEdits");
  expect(asker.resolutions[0]).toMatchObject({
    decision: "allow",
    answer: { mode: "acceptEdits" },
  });
});

test("a plan denial keeps the mode; a plan allow without a mode keeps it too", async () => {
  const h = await createHarness({ layers: [layer("user", { "l1.tools.permissionMode": "plan" })] });
  registerAsker(h, "submit_plan", PLAN, "p-3");
  const first = callTool(h.runtime.tools, h.run(), { id: "call_d", name: "submit_plan", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  await h.runtime.approvals.respond(pendingOf(h).approvalId, {
    decision: "deny",
    answer: { feedback: "split it" },
  });
  await first;
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");
  expect(h.session.sessionValues(h.thread).has("l1.tools.permissionMode")).toBe(false);
});

test("a plan approval whose answer was committed before a crash applies the mode when the plan tool asks again", async () => {
  const h = await createHarness({ layers: [layer("user", { "l1.tools.permissionMode": "plan" })] });
  registerAsker(h, "submit_plan", PLAN, "p-4");
  const first = callTool(h.runtime.tools, h.run(), { id: "call_c", name: "submit_plan", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const request = pendingOf(h);
  // 모드를 쓰는 단계에서 끊긴 것을 흉내 낸다: 해결 이벤트는 커밋되지만 모드 쓰기는 실패한다
  h.session.failNextSettingsWrite({ kind: "io", code: "EIO" });
  await h.runtime.approvals.respond(request.approvalId, {
    decision: "allow",
    answer: { mode: "default" },
  });
  await first;
  expect(h.session.events.filter((event) => event.kind === "approval.resolved")).toHaveLength(1);
  expect(h.runtime.tools.mode(h.thread)).toBe("plan");

  // 재시작한 프로세스에서 계획 도구가 같은 requestKey로 다시 요청한다
  const restarted = createToolRuntime(h.deps);
  const again = await restarted.approvals.request({ ...request }, new AbortController().signal);
  expect(again).toMatchObject({ ok: true, value: { decision: "allow" } });
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  expect(restarted.tools.mode(h.thread)).toBe("default");
  // 한 번 더 요청해도 모드를 다시 쓰지 않는다
  const writes = h.session.sessionValues(h.thread).get("l1.tools.permissionMode");
  await restarted.approvals.request({ ...request }, new AbortController().signal);
  expect(h.session.sessionValues(h.thread).get("l1.tools.permissionMode")).toBe(writes);
});

test("a non-interactive question is denied in the same commit that records it", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-4");
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "call_n",
    name: "ask_user",
    args: {},
  });
  expect(out.blocked).toBeUndefined();
  const commit = h.session.commits.find((entry) => entry.kinds.includes("approval.requested"));
  expect(commit?.kinds).toEqual(["approval.requested", "approval.resolved"]);
  const resolved = parse(
    ApprovalResolvedPayloadSchema,
    h.session.events.find((event) => event.kind === "approval.resolved")?.payload,
  );
  expect(resolved.ok && resolved.value).toMatchObject({
    decision: "deny",
    resolvedBy: "noninteractive",
    answer: null,
  });
  expect(h.session.events.some((event) => event.kind === "checkpoint.step")).toBe(false);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("invalid requests come back as values: bad key, bad remember, duplicate question ids, unanswerable question", async () => {
  const h = await createHarness();
  const origin = {
    threadId: h.thread,
    turnId: null,
    stepId: null,
    toolCallId: null,
    caller: "main",
  } as const;
  const base = { origin, requestKey: "k", title: "T", body: QUESTION, remember: ["once"] } as const;
  const cases: ApprovalRequestInput[] = [
    { ...base, requestKey: "" },
    { ...base, requestKey: "k".repeat(49) },
    { ...base, remember: ["once", "thread"] },
    { ...base, remember: [] },
    {
      ...base,
      body: {
        kind: "question",
        question: {
          questions: [
            { id: "a", text: "x", options: [], multiSelect: false, allowFreeText: true },
            { id: "a", text: "y", options: [], multiSelect: false, allowFreeText: true },
          ],
        },
      },
    },
    {
      ...base,
      body: {
        kind: "question",
        question: {
          questions: [
            { id: "a", text: "x", options: [], multiSelect: false, allowFreeText: false },
          ],
        },
      },
    },
    {
      ...base,
      body: { kind: "plan", plan: { plan: "p", planRef: null, nextModes: ["plan", "plan"] } },
    },
    { ...base, title: "" },
  ];
  await eachInOrder(cases, async (input) => {
    const opened = await h.runtime.approvals.request(input, new AbortController().signal);
    expect(opened).toMatchObject({
      ok: false,
      error: { kind: "rejected", code: "approvals.request_invalid" },
    });
  });
  expect(h.session.events).toHaveLength(0);
});

test("restore returns pending question and plan requests of all kinds after a restart", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-5");
  registerAsker(h, "submit_plan", PLAN, "p-5");
  void callTool(h.runtime.tools, h.run(), { id: "call_r1", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  void callTool(h.runtime.tools, h.run(), { id: "call_r2", name: "submit_plan", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 2);
  const before = h.runtime.approvals.pending(h.thread);

  const restarted = createToolRuntime(h.deps);
  const restored = expectOk(await restarted.approvals.restore(h.thread));
  expect(restored.map((request) => request.approvalId)).toEqual(
    before.map((request) => request.approvalId),
  );
  expect(restored.map((request) => request.body.kind)).toEqual(["question", "plan"]);
  // restore는 두 번 불러도 같다
  expect(expectOk(await restarted.approvals.restore(h.thread))).toHaveLength(2);
  // 재시작한 서비스가 응답을 받아 해결을 커밋한다
  const [question] = restored;
  expect(
    await restarted.approvals.respond(question?.approvalId ?? "", {
      decision: "answer",
      answer: { color: { selected: ["blue"] }, note: { selected: [], text: "ok" } },
    }),
  ).toEqual({ applied: true });
  expect(restarted.approvals.pending(h.thread)).toHaveLength(1);
});
