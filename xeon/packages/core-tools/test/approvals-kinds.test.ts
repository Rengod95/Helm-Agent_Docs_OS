import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { EventId } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  EffectIntentSchema,
  StepCheckpointSchema,
  type ApprovalBodyJson,
  type ApprovalRequestedPayload,
  type ApprovalResolvedPayload,
} from "@fresnel/contracts/records";
import type {
  ApprovalBody,
  ApprovalRequest,
  ApprovalResolution,
  ApprovalRequestInput,
} from "@fresnel/contracts/services";
import { approvalBodyOf } from "../src/approvals/pending.ts";
import { requestCommitKey, resolveCommitKey } from "../src/approvals/keys.ts";
import { createToolRuntime } from "../src/runtime.ts";
import { eachInOrder } from "../src/util.ts";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.4: 질문(question) 승인이 도구 승인과 같은 approval.requested 레코드로 기록된다(TL-12).
// 계획(plan) 승인은 더는 만들지 않는다 [결정: 2026-11-13 사용자]. 옛 기록은 대기 목록에 올리지 않고 건너뛴다. 쓰지도 않는다 [결정: 2026-11-15 사용자].

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

/**
 * 계획 모드가 있던 시절의 계획 승인 본문(옛 기록). 계약은 kind만 보므로 나머지 칸은 타입에 없다. 그래도 저장된 모양 그대로 둔다
 * (`as const`는 리터럴 kind를 지키고, 나머지 칸은 값 검사를 받지 않는다)
 */
const LEGACY_PLAN = {
  kind: "plan",
  plan: { plan: "# Plan\n1. do it", planRef: null, nextModes: ["plan", "acceptEdits"] },
} as const;

interface Asker {
  /** 도구 이름 */
  readonly name: string;
  readonly resolutions: ApprovalResolution[];
}

/** 질문·계획 도구: 실행 안에서 fresnel.approvals.request를 부르고 해결이 오면 끝난다 */
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

test("question_approval_is_an_approval_requested_record: the question is recorded with the shared envelope and its answer is recorded as answer", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-1");
  const question = callTool(h.runtime.tools, h.run(), { id: "call_q", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);

  const requested = h.session.events.filter((event) => event.kind === "approval.requested");
  expect(requested).toHaveLength(1);
  const parsed = parse(ApprovalRequestedPayloadSchema, requested[0]?.payload);
  if (!parsed.ok) throw new Error("payload did not parse");
  expect(parsed.value.body.kind).toBe("question");
  expect(parsed.value.remember).toEqual(["once"]);

  const [q] = h.runtime.approvals.pending(h.thread);
  expect(
    await h.runtime.approvals.respond(q?.approvalId ?? "", {
      decision: "answer",
      answer: { color: { selected: ["red"] }, note: { selected: [], text: "no" } },
    }),
  ).toEqual({ applied: true });
  expect((await question).blocked).toBeUndefined();
  const resolved = h.session.events
    .filter((event) => event.kind === "approval.resolved")
    .map((event) => parse(ApprovalResolvedPayloadSchema, event.payload));
  expect(resolved.map((entry) => (entry.ok ? entry.value.decision : "invalid"))).toEqual([
    "answer",
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
    const outcome = await h.runtime.approvals.respond(id, response);
    expect(outcome).toMatchObject({ applied: false, reason: "answer_invalid" });
    // 어디가 맞지 않는지 한 줄을 알린다
    expect(outcome.detail ?? "").not.toBe("");
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

/**
 * 계획 모드가 있던 시절의 승인 기록을 흉내 낸다: `approval.requested`를 커밋하고 approvalId(요청 이벤트 id)를 돌려준다.
 * 새 코드는 계획 요청을 만들지 않으므로 시험이 직접 쓴다
 */
function seedLegacyPlan(h: Harness, requestKey: string, body: ApprovalBodyJson): EventId {
  const requestedId = h.deps.ids.next("evt");
  const payload: ApprovalRequestedPayload = {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey,
    title: "Review the plan",
    body,
    remember: ["once"],
    surfaceThreadId: h.thread,
    requestedAt: 1,
  };
  const draft = h.deps.producer.draft({
    id: requestedId,
    kind: "approval.requested",
    threadId: h.thread,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
  });
  const committed = h.session.commit({
    threadId: h.thread,
    requestId: requestCommitKey(h.thread, requestKey),
    fingerprintSource: { kind: "approval.requested", requestKey },
    build: () => ({ kind: "append", drafts: [draft], checkpoint: null }),
  });
  expect(committed.ok).toBe(true);
  return requestedId;
}

/** 옛 계획 승인의 해결 기록(`approval.resolved`)을 커밋한다 */
function seedLegacyResolution(
  h: Harness,
  approvalId: EventId,
  resolution: ApprovalResolvedPayload,
): void {
  const draft = h.deps.producer.draft({
    id: h.deps.ids.next("evt"),
    kind: "approval.resolved",
    threadId: h.thread,
    turnId: null,
    stepId: null,
    causationId: approvalId,
    correlationId: null,
    payload: resolution,
  });
  const committed = h.session.commit({
    threadId: h.thread,
    requestId: resolveCommitKey(approvalId),
    fingerprintSource: { kind: "approval.resolved", approvalId },
    build: () => ({ kind: "append", drafts: [draft], checkpoint: null }),
  });
  expect(committed.ok).toBe(true);
}

test("restore returns pending question requests after a restart and the answer is recorded", async () => {
  const h = await createHarness();
  registerAsker(h, "ask_user", QUESTION, "q-5");
  void callTool(h.runtime.tools, h.run(), { id: "call_r1", name: "ask_user", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const before = h.runtime.approvals.pending(h.thread);

  const restarted = createToolRuntime(h.deps);
  const restored = expectOk(await restarted.approvals.restore(h.thread));
  expect(restored.map((request) => request.approvalId)).toEqual(
    before.map((request) => request.approvalId),
  );
  expect(restored.map((request) => request.body.kind)).toEqual(["question"]);
  // restore는 두 번 불러도 같다
  expect(expectOk(await restarted.approvals.restore(h.thread))).toHaveLength(1);
  // 재시작한 서비스가 응답을 받아 해결을 커밋한다
  const [question] = restored;
  expect(
    await restarted.approvals.respond(question?.approvalId ?? "", {
      decision: "answer",
      answer: { color: { selected: ["blue"] }, note: { selected: [], text: "ok" } },
    }),
  ).toEqual({ applied: true });
  expect(restarted.approvals.pending(h.thread)).toHaveLength(0);
});

test("a waiting old plan approval is skipped on restore: it is not listed, nothing is written, and the tool approval beside it stays pending", async () => {
  const h = await createHarness();
  const legacy = seedLegacyPlan(h, "legacy-plan-1", LEGACY_PLAN);
  const tool = expectOk(
    await h.runtime.approvals.open({
      origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
      requestKey: "tool-keep-1",
      title: "Run a command?",
      body: {
        kind: "tool",
        tool: {
          toolName: "bash",
          risk: "exec",
          args: { command: "ls" },
          argsHash: "h1",
          ruleId: "default.bash-ask",
        },
      },
      remember: ["once"],
    }),
  );
  const written = h.session.events.length;

  const restarted = createToolRuntime(h.deps);
  const restored = expectOk(await restarted.approvals.restore(h.thread));
  expect(restored.map((request) => request.approvalId)).toEqual([tool.request.approvalId]);
  expect(restored.map((request) => request.body.kind)).toEqual(["tool"]);
  expect(restarted.approvals.get(legacy)).toBeUndefined();
  expect(restarted.approvals.pending(h.thread).map((request) => request.body.kind)).toEqual([
    "tool",
  ]);
  // 옛 계획 승인은 정착시키지 않는다. 기록에 새로 커밋된 것이 없다
  expect(h.session.events).toHaveLength(written);
  expect(h.session.events.filter((event) => event.kind === "approval.resolved")).toHaveLength(0);
});

test("an old plan approval that was already answered is passed over: restore lists nothing and writes nothing", async () => {
  const h = await createHarness();
  const legacy = seedLegacyPlan(h, "legacy-plan-2", LEGACY_PLAN);
  seedLegacyResolution(h, legacy, {
    approvalId: legacy,
    decision: "allow",
    answer: { mode: "acceptEdits" },
    remember: "once",
    requestedRemember: null,
    resolvedBy: "user",
  });
  const written = h.session.events.length;

  const restarted = createToolRuntime(h.deps);
  expect(expectOk(await restarted.approvals.restore(h.thread))).toEqual([]);
  expect(restarted.approvals.get(legacy)).toBeUndefined();
  expect(h.session.events).toHaveLength(written);
  expect(h.session.sessionValues(h.thread).has("l1.tools.permissionMode")).toBe(false);
});

test("a legacy plan body decodes to no approval body, so the scan never lists it", () => {
  expect(approvalBodyOf(LEGACY_PLAN)).toBeUndefined();
});
