import { expect, test } from "bun:test";
import { createWorld, deferred, flush, openTurn, userDraft, watch } from "./support/world.ts";

test("activity counts live turns and tasks, and queued inputs of every thread", async () => {
  const world = createWorld();
  const { tasks } = world;
  expect(tasks.activity()).toEqual({ liveTurns: 0, liveTasks: 0, queuedInputs: 0 });

  const { thread, turn } = openTurn(world, { intent: false });
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const background = tasks.openScope(thread, { kind: "subagent", id: "thr_bg", background: true });
  // thread와 app 노드는 세지 않고, 백그라운드 subagent는 liveTasks에 센다
  expect(tasks.activity()).toMatchObject({ liveTurns: 1, liveTasks: 3 });

  world.session.openThread(world.ids.next("thr"));
  await tasks.inputs.enqueue(userDraft(world.threadId, "a"));
  expect(tasks.activity().queuedInputs).toBe(1);

  await tool.settle();
  expect(tasks.activity()).toMatchObject({ liveTurns: 1, liveTasks: 2 });
  await turn.settle();
  expect(tasks.activity()).toMatchObject({ liveTurns: 0, liveTasks: 1 });
  expect(background.state).toBe("live");
});

test("queued inputs are summed across threads and pages", async () => {
  const world = createWorld();
  const other = world.ids.next("thr");
  world.session.openThread(other);
  await world.tasks.inputs.enqueue(userDraft(world.threadId, "a"));
  await world.tasks.inputs.enqueue(userDraft(world.threadId, "b"));
  await world.tasks.inputs.enqueue(userDraft(other, "c"));
  expect(world.tasks.activity().queuedInputs).toBe(3);
  // 거둔 입력과 닫힌 thread의 입력은 세지 않는다
  await world.tasks.inputs.withdraw(world.threadId, "all", "user");
  expect(world.tasks.activity().queuedInputs).toBe(1);
  world.session.setThreadStatus(other, "closed");
  expect(world.tasks.activity().queuedInputs).toBe(0);
});

test("onActivity fires when nodes open or settle and when the queue changes", async () => {
  const world = createWorld();
  const { tasks } = world;
  let count = 0;
  const off = tasks.onActivity(() => {
    count += 1;
  });
  const { turn } = openTurn(world, { intent: false });
  const afterOpen = count;
  expect(afterOpen).toBeGreaterThanOrEqual(2); // thread, turn
  await tasks.inputs.enqueue(userDraft(world.threadId, "a"));
  expect(count).toBe(afterOpen + 1);
  await turn.settle();
  expect(count).toBe(afterOpen + 2);
  off();
  await tasks.inputs.enqueue(userDraft(world.threadId, "b"));
  expect(count).toBe(afterOpen + 2);
});

test("a throwing activity listener is logged and does not stop the others", async () => {
  const world = createWorld();
  let seen = 0;
  world.tasks.onActivity(() => {
    throw new Error("listener failed");
  });
  world.tasks.onActivity(() => {
    seen += 1;
  });
  openTurn(world, { intent: false });
  expect(seen).toBeGreaterThan(0);
  expect(
    world.log.records.some((record) => record.event === "tasks.on_activity_listener_failed"),
  ).toBe(true);
});

test("close signals every node including background ones and writes no intent", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { thread, turn } = openTurn(world);
  const background = tasks.openScope(thread, { kind: "subagent", id: "thr_bg", background: true });
  const work = deferred<void>();
  const held = turn.track(work.promise);

  const closing = watch(tasks.close());
  expect(turn.signal.aborted).toBe(true);
  expect(background.signal.aborted).toBe(true);
  expect(tasks.root.abortReason).toEqual({ code: "error", message: "tasks.closed" });
  // 신호만 보내고 의도는 쓰지 않는다. 다음 열기에서 재개된다
  expect(session.events).toEqual([]);
  expect(session.commitCalls).toBe(0);

  await flush();
  expect(closing.done).toBe(false);
  work.resolve();
  await held;
  await closing.whenDone;
  expect(closing.done).toBe(true);
  expect(turn.state).toBe("settled");
  expect(background.state).toBe("settled");
});

test("close is idempotent", async () => {
  const world = createWorld();
  openTurn(world, { intent: false });
  await world.tasks.close();
  await world.tasks.close();
  expect(world.tasks.root.state).toBe("settled");
});
