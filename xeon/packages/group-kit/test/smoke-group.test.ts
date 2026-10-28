import { expect, test } from "bun:test";
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@xeon/contracts/conversation";
import { validateManifest } from "@xeon/contracts/extensions";
import { createTestHost, flushMicrotasks, type TestHost } from "@xeon/ext-host/testing";
import * as entry from "../src/index.ts";
import { SMOKE_GROUP_MANIFEST, checkGroup, smokeGroup } from "../src/testing/index.ts";

const userText: UserMessage = { role: "user", content: "hello", timestamp: 1_700_000_000_002 };
const assistantStop: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "answer" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  },
  stopReason: "stop",
  timestamp: 1_700_000_000_004,
};
const toolResult: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [{ type: "text", text: "file body" }],
  isError: false,
  timestamp: 1_700_000_000_005,
};

function install(
  t: TestHost,
  group: ReturnType<typeof smokeGroup>,
): ReturnType<TestHost["host"]["install"]> {
  return t.host.install({
    manifest: group.manifest,
    entry: group.entry,
    loadIndex: 0,
    builtin: true,
  });
}

test("group-kit entry loads", () => {
  expect(typeof entry).toBe("object");
});

test("smoke.manifest-passes-validation", async () => {
  const validated = validateManifest(SMOKE_GROUP_MANIFEST);
  expect(validated.issues).toEqual([]);
  expect(validated.manifest?.name).toBe("smoke-group");

  // 실제 등록은 호스트가 setup 직후 validateUsage로 대조한다
  const t = await createTestHost();
  const installed = await install(t, smokeGroup());
  expect(installed.setups[0]?.status).toBe("applied");
  expect(installed.issues).toEqual([]);
  expect(t.diagnostics).toEqual([]);
});

test("smoke.uses-on-post-drive-in-one-turn", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const group = smokeGroup();
  await install(t, group);
  await t.host.openThread(thread);
  await t.settled();

  // drive: 임대를 받아 loop.turn을 한 번 부르고 상태를 커밋한다
  expect(t.loop.turns).toHaveLength(1);
  const kinds = t.records.events(thread).map((event) => event.kind);
  expect(kinds).toEqual(["scope.changed", "lease.acquired", "grp.smoke-group.state.committed"]);

  // tool_call: 쓰기 도구만 거부한다
  const denied = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_w", toolName: "write", input: {} },
    { threadId: thread, dispatchKey: "tc-w" },
  );
  expect(denied.decision).toMatchObject({ block: true });
  const allowed = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_r", toolName: "read", input: {} },
    { threadId: thread, dispatchKey: "tc-r" },
  );
  expect(allowed.decision).toBeUndefined();
  expect(group.probe.deniedCalls).toEqual(["call_w"]);

  // turn_end: followUp을 post한다
  const stepId = t.ids.next("stp");
  await t.host.dispatch(
    "boundary.step.after",
    {
      stepIndex: 1,
      stepId,
      message: assistantStop,
      toolResults: [toolResult],
      messageItemId: t.ids.next("itm"),
      toolResultItemIds: [t.ids.next("itm")],
      context: {
        contextMessages: [userText, assistantStop],
        llmMessages: [userText],
        pendingMessages: [],
        canContinue: true,
      },
    },
    {
      threadId: thread,
      dispatchKey: `${stepId}:boundary.step.after`,
      initial: { entries: [], continue: false },
      finalize: (value) => value,
    },
  );
  expect(group.probe.turnEndSteps).toEqual([stepId]);
  expect(t.queue.items).toMatchObject([
    { scopeId: "smoke-group", when: "followUp", requestId: `smoke:${stepId}` },
  ]);
});

test("smoke.toggle-applies-at-step-boundary", async () => {
  const gate: { open: () => void } = { open: () => {} };
  const t = await createTestHost({
    loop: {
      runTurn: async () => {
        await new Promise<void>((resolve) => {
          gate.open = resolve;
        });
        return { outcome: { turnId: t.ids.next("trn"), status: "completed" }, usage: null };
      },
    },
  });
  const thread = t.newThread();
  await install(t, smokeGroup());
  await t.host.openThread(thread);
  await flushMicrotasks(200);
  // drive의 loop.turn이 진행 중이다
  expect(t.loop.turns).toHaveLength(1);

  t.host.scope("smoke-group")?.disable();
  // 요청만 기록되었고 경계 전에는 아직 켜져 있다
  expect(t.host.scope("smoke-group")?.status).not.toBe("disabled");
  const drafts = await t.boundary(thread).stepEnd();
  expect(drafts.map((draft) => draft.kind)).toEqual(["lease.released", "scope.changed"]);
  expect(drafts[0]?.payload).toMatchObject({ reason: "disabled" });
  expect(t.host.scope("smoke-group")?.status).toBe("disabled");

  // 진행 중이던 turn은 끊기지 않고 정착한다
  expect(t.loop.turns[0]?.signal.aborted).toBe(false);
  gate.open();
  await t.settled();
  expect(t.loop.status(thread)).toBe("idle");
});

test("smoke.resume-reads-committed-state", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await install(first, smokeGroup());
  await first.host.openThread(thread);
  await first.settled();
  expect(first.loop.turns).toHaveLength(1);

  // 같은 저장소를 새 호스트에 넘겨 재시작을 흉내 낸다
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await install(second, smokeGroup());
  await second.host.openThread(thread);
  await second.settled();
  const loaded = await second.records.loadThread(thread);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.value.states.map((state) => state.doc)).toEqual([{ count: 1 }]);
  // 커밋된 count가 1이라 drive는 새 turn을 만들지 않고, 임대도 새로 만들지 않는다
  expect(second.loop.turns).toHaveLength(1);
  const acquired = second.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquired).toHaveLength(1);
});

test("smoke.check-group-has-no-errors", async () => {
  const group = smokeGroup();
  // M1 테스트 그룹은 defineGroup으로 만든 모듈이다(G-16). 선언과 실제 등록이 맞는다
  expect(group.module.stateVersion).toBe(1);
  expect(group.module.entry).toBe(group.entry);
  const issues = await checkGroup(group.module);
  expect(issues.filter((found) => found.severity === "error")).toEqual([]);
});
