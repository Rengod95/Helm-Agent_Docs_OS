// M1 걷는 골격 스모크의 X 쪽 모양: 테스트용 그룹이 on(tool_call, turn_end), post, drive를 쓴다(X.primitives.plan §6 7번).
import { expect, test } from "bun:test";
import { FIRST_DENY } from "@xeon/contracts/extensions";
import { createSmokeGroup, createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import { assistantStop, toolResultMessage, userText } from "./fixtures/support.ts";

test("the smoke group denies a tool, adds an entry at turn_end, posts and drives", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const { unit, probe } = createSmokeGroup({ ids: t.ids });
  const installed = await t.host.install(unit);
  expect(installed.setups[0]?.status).toBe("applied");
  expect(installed.issues).toEqual([]);
  await t.host.openThread(thread);
  await t.settled();

  // drive: 임대를 받아 loop.turn을 한 번 부르고 상태를 커밋한다
  expect(t.loop.turns).toHaveLength(1);
  const kinds = t.records.events(thread).map((event) => event.kind);
  expect(kinds).toEqual(["scope.changed", "lease.acquired", "grp.smoke-group.state.committed"]);

  // tool_call: 특정 도구만 거부한다
  const denied = await t.host.dispatch(
    "tool_call",
    { toolCallId: "call_1", toolName: "danger", input: {} },
    { threadId: thread, dispatchKey: "tc1" },
  );
  expect(denied.decision).toMatchObject({ block: true });
  expect(denied.substituted).toBe(false);
  const allowed = await t.host.dispatch(
    "tool_call",
    { toolCallId: "call_2", toolName: "read", input: {} },
    { threadId: thread, dispatchKey: "tc2" },
  );
  expect(allowed.decision).toBeUndefined();
  expect(probe.deniedCalls).toEqual(["call_1"]);
  expect(denied.decision).not.toEqual(FIRST_DENY.tool_call);

  // turn_end: 엔트리를 더하고 followUp을 post한다
  const stepId = t.ids.next("stp");
  const turnEnd = await t.host.dispatch(
    "turn_end",
    {
      stepIndex: 2,
      stepId,
      message: assistantStop,
      toolResults: [toolResultMessage],
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
      dispatchKey: `${stepId}:turn_end`,
      initial: { entries: [], continue: false },
      finalize: (value) => value,
    },
  );
  expect(turnEnd.value.entries).toHaveLength(1);
  expect(turnEnd.value.entries[0]?.kind).toBe("grp.smoke-group.note.recorded");
  expect(t.queue.items).toMatchObject([
    { scopeId: "smoke-group", when: "followUp", requestId: `smoke:${stepId}` },
  ]);
});

test("turning the group off mid-turn applies at the step boundary and lets the turn settle", async () => {
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
  const { unit } = createSmokeGroup({ ids: t.ids });
  await t.host.install(unit);
  await t.host.openThread(thread);
  await flushMicrotasks(200);
  // drive의 loop.turn이 진행 중이다
  expect(t.loop.turns).toHaveLength(1);
  expect(t.loop.status(thread)).toBe("running");

  t.host.scope("smoke-group")?.disable();
  const drafts = await t.boundary(thread).stepEnd();
  expect(drafts.map((draft) => draft.kind)).toEqual(["lease.released", "scope.changed"]);
  expect(drafts[0]?.payload).toMatchObject({ reason: "disabled" });
  expect(drafts[1]?.payload).toMatchObject({ status: "disabled" });
  expect(t.host.scope("smoke-group")?.status).toBe("disabled");

  // 진행 중이던 turn은 끊기지 않고 정착까지 진행한다
  expect(t.loop.turns[0]?.signal.aborted).toBe(false);
  gate.open();
  await t.settled();
  expect(t.loop.status(thread)).toBe("idle");
  const kinds = t.records.events(thread).map((event) => event.kind);
  expect(kinds).toContain("lease.released");
  // 반납된 임대로는 더 커밋하지 않는다(상태 커밋은 turn 정착 뒤 resume하지만 임대 신호는 중단되었다)
  expect(kinds.filter((kind) => kind === "lease.acquired")).toHaveLength(1);
});
