import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { StepCheckpointSchema } from "@xeon/contracts/records";
import type { ExtensionUnit } from "@xeon/ext-host";
import { resolveModel, toolRunContext } from "../src/loop/turn-run.ts";
import { createHarness } from "./support/harness.ts";
import { createRig } from "./support/loop-rig.ts";
import { countKind, firstOfKind, kindsOf } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const read: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
  stopReason: "toolUse",
};
const done: ScriptedResponse = {
  kind: "message",
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
};

test("the_tool_run_context_carries_the_turn_step_and_origin", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const turnStarted = firstOfKind(h.fake.events(h.threadId), "turn.started");
  const stepIds = h.fake
    .events(h.threadId)
    .filter((event) => event.kind === "step.started")
    .map((event) => event.stepId);
  // 실행 맥락은 도구 호출이 있는 단계의 배치마다 만든다. 이 시나리오는 첫 단계에만 도구 호출이 있다
  expect(h.tools.runs).toHaveLength(1);
  for (const [index, run] of h.tools.runs.entries()) {
    expect(run.threadId).toBe(h.threadId);
    expect(run.turnId).toBe(turnStarted?.turnId ?? run.turnId);
    expect(turnStarted?.turnId).toBeDefined();
    expect(stepIds[index]).toBeDefined();
    expect(run.stepId).toBe(stepIds[index] ?? run.stepId);
    expect(run).toMatchObject({
      caller: "main",
      depth: 0,
      interactive: true,
      surfaceThreadId: h.threadId,
    });
  }
});

test("a_drive_turn_is_not_interactive", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  await h.loop.runTurn({
    threadId: h.threadId,
    scopeId: "test-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    input: { kind: "user", content: "drive" },
    signal: new AbortController().signal,
  });
  expect(h.tools.runs.every((run) => !run.interactive)).toBe(true);
});

test("tool_run_drafts_build_scoped_drafts_for_the_tool_result_and_the_waiting_checkpoint", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const run = h.tools.runs[0];
  expect(run).toBeDefined();
  if (run === undefined) return;
  const itemId = h.fake.events(h.threadId).find((event) => event.kind === "turn.started")?.payload;
  expect(itemId).toBeDefined();

  const waiting = run.drafts.waitingCheckpoint([
    { toolCallId: "c9", effectId: null, waiting: "approval" },
  ]);
  expect(waiting.kind).toBe("checkpoint.step");
  expect(waiting).toMatchObject({ threadId: h.threadId, turnId: run.turnId, stepId: run.stepId });
  const checkpoint = parse(StepCheckpointSchema, waiting.payload);
  expect(checkpoint.ok).toBe(true);
  expect(checkpoint.ok && checkpoint.value).toMatchObject({
    next: "await_input",
    stepId: run.stepId,
    pendingToolCalls: [{ toolCallId: "c9", waiting: "approval" }],
  });
  // leafEventId는 피드가 알려 준 활성 가지의 마지막 이벤트다
  expect(checkpoint.ok ? checkpoint.value.leafEventId : null).toBe(
    h.fake.events(h.threadId).at(-1)?.id ?? null,
  );
});

test("the_waiting_checkpoint_never_records_a_placeholder_model", async () => {
  const h = await createHarness({ script: [], withoutLoop: true });
  const rig = createRig(h);
  const { run } = rig;
  run.thread.leaf = run.ctx.ids.next("evt");
  const step = {
    threadId: rig.threadId,
    turnId: rig.turnId,
    stepId: run.ctx.ids.next("stp"),
    stepIndex: 0,
  };
  const pending = [{ toolCallId: "c9", effectId: null, waiting: "approval" } as const];
  // 모델을 해석하기 전에는 도구 배치가 시작될 수 없다. 바인딩이 없으면 빈 provider·modelId를 쓰지 않고 불변식 위반으로 멈춘다
  expect(() => toolRunContext(run, step).drafts.waitingCheckpoint(pending)).toThrow(
    "loop.waiting_checkpoint_without_binding",
  );
  const resolved = resolveModel(run);
  expect(resolved.ok).toBe(true);
  const waiting = toolRunContext(run, step).drafts.waitingCheckpoint(pending);
  const checkpoint = parse(StepCheckpointSchema, waiting.payload);
  expect(checkpoint.ok && checkpoint.value.model.provider).not.toBe("");
  expect(checkpoint.ok && checkpoint.value.model.modelId).not.toBe("");
});

const promptEntry: ExtensionEntry = ({ manifest, scope }) => {
  scope(manifest.name, {}, (g) => {
    g.on("before_agent_start", () => ({
      message: {
        customType: "grp.prompt-group.note.recorded",
        content: "remember: be brief",
        display: false,
      },
      systemPrompt: "You are a terse assistant.",
    }));
  });
};

function promptGroup(): ExtensionUnit {
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "prompt-group",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["before_agent_start"],
      usesDrive: false,
    }),
    entry: promptEntry,
    loadIndex: 4,
    builtin: false,
  };
}

test("before_agent_start_messages_are_recorded_as_custom_items_and_the_prompt_change_is_used", async () => {
  const h = await createHarness({ script: [done] });
  await h.host.host.install(promptGroup());
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  const keys = h.fake.commitKeys(h.threadId);
  const turnId = firstOfKind(events, "turn.started")?.turnId;
  const prestart = events.flatMap((event, index) =>
    keys[index] === `turn:${turnId}:prestart` ? [event] : [],
  );
  expect(prestart).toHaveLength(1);
  expect(prestart[0]?.payload).toMatchObject({
    item: { kind: "custom", message: { customType: "grp.prompt-group.note.recorded" } },
  });
  // 첫 요청: 접두 system은 기본 프롬프트 그대로이고, 핸들러가 바꾼 프롬프트는 요청 끝 volatile 안내로 간다. custom 메시지는 대화에 있다
  const request = h.models.requests[0]?.messages ?? [];
  expect(request[0]).toMatchObject({ role: "system", content: "You are a test assistant." });
  expect(JSON.stringify(request)).toContain("remember: be brief");
  expect(h.context.assembled[0]?.volatile["instructions"]).toBe("You are a terse assistant.");
  expect(countKind(events, "turn.completed")).toBe(1);
});

test("resume_from_turn_start_runs_the_first_step_and_does_not_repeat_before_agent_start", async () => {
  const h = await createHarness({ script: [done] });
  await h.host.host.install(promptGroup());
  await h.host.settled();
  h.fake.crashAfter((key) => key.endsWith(":prestart"));
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const cut = h.fake.events(h.threadId);
  expect(countKind(cut, "turn.started")).toBe(1);
  expect(countKind(cut, "step.started")).toBe(0);

  const h2 = await h.restart({ script: [done] });
  await h2.host.host.install(promptGroup());
  await h2.host.settled();
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "turn_start" });
  await h2.settle();
  const events = h2.fake.events(h2.threadId);
  // 이미 기록된 prestart item이 있으므로 before_agent_start를 다시 발화하지 않는다
  const customs = events.filter(
    (event) =>
      event.kind === "item.recorded" &&
      JSON.stringify(event.payload).includes("grp.prompt-group.note.recorded"),
  );
  expect(customs).toHaveLength(1);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(kindsOf(events).filter((kind) => kind === "step.started")).toHaveLength(1);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({ status: "completed" });
});

test("resume_from_turn_end_commits_the_turn_end_without_a_model_request", async () => {
  const h = await createHarness({ script: [done] });
  h.fake.crashAfter((key) => /^step:.*:0:end$/.test(key));
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(0);

  const h2 = await h.restart({ script: [] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "turn_end" });
  await h2.settle();
  expect(h2.models.requests).toHaveLength(0);
  expect(firstOfKind(h2.fake.events(h2.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
    stepCount: 1,
  });
});

test("an_owner_cancelled_turn_is_closed_instead_of_resumed", async () => {
  const h = await createHarness({ script: [read, done], tools: [{ name: "read" }] });
  h.fake.crashAfter((key) => /^step:.*:0:end$/.test(key));
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  const h2 = await h.restart({ script: [], cancelledByOwner: () => true });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({
    status: "closed",
    reason: "owner_cancelled",
  });
  await h2.settle();
  expect(firstOfKind(h2.fake.events(h2.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
  });
  expect(h2.models.requests).toHaveLength(0);
});

test("interrupt_on_an_idle_thread_reports_false", async () => {
  const h = await createHarness();
  expect(await h.loop.interrupt(h.threadId)).toBe(false);
});
