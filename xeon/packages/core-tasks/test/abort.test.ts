import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { AbortReason } from "@xeon/contracts/services";
import { createWorld, deferred, flush, openTurn, turnAbortIntent, watch } from "./support/world.ts";

const USER_STOP: AbortReason = { code: "user", message: "stop" };

test("scope_abort_cascades_to_children", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn } = openTurn(world);
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const spawn = tasks.openScope(turn, { kind: "tool", id: "tc2" });
  const child = tasks.openScope(spawn, { kind: "subagent", id: "thr_child" });
  const childTurn = tasks.openScope(child, { kind: "turn", id: "trn_child" });
  const grandTool = tasks.openScope(childTurn, { kind: "tool", id: "tc3" });

  const work = deferred<void>();
  const held = grandTool.track(work.promise);

  const result = await tasks.abort(turn, USER_STOP);
  expect(result.ok).toBe(true);
  if (!result.ok || result.value.status !== "signalled") throw new Bug("expected signalled");
  for (const node of [turn, tool, spawn, child, childTurn, grandTool]) {
    expect(node.signal.aborted).toBe(true);
    // 부모에서 전파된 신호의 reason은 부모의 reason과 같은 객체다
    expect(node.signal.reason).toBe(USER_STOP);
    expect(node.abortReason).toBe(USER_STOP);
  }

  // settled는 자식이 모두 정착한 뒤에 이행한다
  const settling = watch(result.value.settled);
  await flush();
  expect(settling.done).toBe(false);
  expect(grandTool.state).toBe("aborting");
  work.resolve();
  await held;
  const outcome = await result.value.settled;
  expect(outcome).toEqual({ aborted: true, reason: USER_STOP });
  expect(grandTool.state).toBe("settled");
  // turn.abort_requested는 직접 한 건. 의도 기록기가 없는 자식 노드는 쓰지 않는다
  expect(session.events.filter((event) => event.kind === "turn.abort_requested").length).toBe(1);
});

test("background_scope_survives_parent_abort", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread, turn } = openTurn(world);
  const background = tasks.openScope(thread, { kind: "subagent", id: "thr_bg", background: true });
  const bgTurn = tasks.openScope(background, { kind: "turn", id: "trn_bg" });

  await tasks.abort(turn, USER_STOP);
  expect(turn.signal.aborted).toBe(true);
  expect(background.signal.aborted).toBe(false);
  expect(bgTurn.signal.aborted).toBe(false);

  // 부모 turn의 정착은 백그라운드를 기다리지 않는다
  await turn.settle();
  expect(turn.state).toBe("settled");
  expect(background.state).toBe("live");

  // thread 노드의 settle도 백그라운드 자식을 기다리지 않는다
  await thread.settle();
  expect(thread.state).toBe("settled");
  expect(bgTurn.state).toBe("live");
});

test("a background abort crosses the boundary", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread } = openTurn(world);
  const background = tasks.openScope(thread, { kind: "subagent", id: "thr_bg", background: true });
  const bgTurn = tasks.openScope(background, { kind: "turn", id: "trn_bg" });
  const bgTool = tasks.openScope(bgTurn, { kind: "tool", id: "tc_bg" });

  // 백그라운드 노드의 부모는 thread다(spec §4.1). 경계를 넘는 취소는 그 위쪽 노드에서 건다
  await tasks.abort(thread, USER_STOP, { background: true });
  expect(background.signal.aborted).toBe(true);
  expect(bgTurn.signal.aborted).toBe(true);
  expect(bgTool.signal.aborted).toBe(true);
  expect(bgTool.signal.reason).toBe(USER_STOP);
});

test("aborting the background node itself does not touch its parent", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread } = openTurn(world);
  const background = tasks.openScope(thread, { kind: "subagent", id: "thr_bg", background: true });
  await tasks.abort(background, USER_STOP);
  expect(background.signal.aborted).toBe(true);
  expect(thread.signal.aborted).toBe(false);
});

test("abort_twice_returns_already_aborting", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn } = openTurn(world);
  // turn의 주 작업이 아직 끝나지 않은 상태
  const running = deferred<void>();
  const held = turn.track(running.promise);
  const first = await tasks.abort(turn, USER_STOP);
  const second = await tasks.abort(turn, { code: "user", message: "again" });
  expect(first.ok && first.value.status).toBe("signalled");
  expect(second.ok && second.value.status).toBe("already_aborting");
  // 의도 이벤트는 하나
  expect(session.events.filter((event) => event.kind === "turn.abort_requested").length).toBe(1);
  expect(session.commitCalls).toBe(1);
  // 처음 사유가 남는다
  expect(turn.abortReason).toBe(USER_STOP);
  running.resolve();
  await held;
  await turn.settle();
});

test("abort on a settled node is already_settled and writes nothing", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn } = openTurn(world);
  await turn.settle();
  const result = await tasks.abort(turn, USER_STOP);
  expect(result).toEqual({ ok: true, value: { status: "already_settled" } });
  expect(session.commitCalls).toBe(0);
});

test("the direct intent carries the reason and cause, and is the only intent for that turn", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn, turnId } = openTurn(world);
  await tasks.abort(turn, USER_STOP);
  const [event, ...rest] = session.events;
  expect(rest).toEqual([]);
  expect(event?.kind).toBe("turn.abort_requested");
  expect(event?.turnId).toBe(turnId);
  expect(event?.payload).toEqual({
    reason: { code: "user", message: "stop" },
    cause: "direct",
    background: false,
  });
});

test("a durable child writes its own cascade intent after the direct one", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn, turnId } = openTurn(world);
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const child = tasks.openScope(tool, { kind: "subagent", id: "thr_child" });
  const childTurnId = world.ids.next("trn");
  tasks.openScope(child, {
    kind: "turn",
    id: childTurnId,
    abortIntent: turnAbortIntent(world, childTurnId),
  });

  await tasks.abort(turn, USER_STOP);
  const intents = session.events.filter((event) => event.kind === "turn.abort_requested");
  expect(intents.map((event) => event.turnId)).toEqual([turnId, childTurnId]);
  expect(intents.map((event) => event.payload)).toEqual([
    { reason: { code: "user", message: "stop" }, cause: "direct", background: false },
    { reason: { code: "user", message: "stop" }, cause: "cascade", background: false },
  ]);
});

test("aborting a durable child directly first means the parent abort does not repeat its intent", async () => {
  const world = createWorld();
  const { tasks, session } = world;
  const { turn, turnId } = openTurn(world);
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const child = tasks.openScope(tool, { kind: "subagent", id: "thr_child" });
  const childTurnId = world.ids.next("trn");
  const childTurn = tasks.openScope(child, {
    kind: "turn",
    id: childTurnId,
    abortIntent: turnAbortIntent(world, childTurnId),
  });

  await tasks.abort(childTurn, { code: "budget", message: null });
  await tasks.abort(turn, USER_STOP);
  const intents = session.events.filter((event) => event.kind === "turn.abort_requested");
  expect(intents.map((event) => event.turnId)).toEqual([childTurnId, turnId]);
  expect(childTurn.abortReason).toEqual({ code: "budget", message: null });
});

test("aborting the app node closes the whole tree", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread } = openTurn(world, { intent: false });
  const result = await tasks.abort(tasks.root, { code: "error", message: null });
  expect(result.ok && result.value.status).toBe("signalled");
  expect(thread.signal.aborted).toBe(true);
});

test("a scope from another tree cannot be aborted", async () => {
  const world = createWorld();
  const other = createWorld();
  const rejected = await world.tasks.abort(other.tasks.root, USER_STOP).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(rejected).toBeInstanceOf(Bug);
});
