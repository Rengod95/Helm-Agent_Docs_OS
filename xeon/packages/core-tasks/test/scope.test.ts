import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { createWorld, deferred, flush, openTurn, watch } from "./support/world.ts";

test("settle_order_bottom_up", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread, turn } = openTurn(world, { intent: false });
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  const child = tasks.openScope(tool, { kind: "subagent", id: "thr_child" });
  const childTurn = tasks.openScope(child, { kind: "turn", id: "trn_child" });
  const grandTool = tasks.openScope(childTurn, { kind: "tool", id: "tc3" });

  const order: string[] = [];
  const work = deferred<void>();
  const hold = grandTool.track(work.promise);
  const note = (name: string) => (): void => {
    order.push(name);
  };
  watch(turn.settle(), note("turn"));
  watch(tool.settle(), note("tool"));
  watch(child.settle(), note("subagent"));
  watch(childTurn.settle(), note("childTurn"));
  watch(grandTool.settle(), note("grandTool"));
  await flush();
  expect(order).toEqual([]);
  expect(turn.state).toBe("settling");

  work.resolve();
  await hold;
  await turn.settle();
  expect(order).toEqual(["grandTool", "childTurn", "subagent", "tool", "turn"]);
  expect(grandTool.state).toBe("settled");
  expect(thread.state).toBe("live");
});

test("a node does not settle before its tracked work ends", async () => {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  const work = deferred<number>();
  const tracked = turn.track(work.promise);
  const settling = watch(turn.settle());
  await flush();
  expect(settling.done).toBe(false);
  work.resolve(7);
  expect(await tracked).toBe(7);
  await turn.settle();
  expect(settling.done).toBe(true);
});

test("settle returns the same promise and the outcome carries the abort reason", async () => {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  expect(turn.settle()).toBe(turn.settle());
  const outcome = await turn.settle();
  expect(outcome).toEqual({ aborted: false, reason: null });
});

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (caught) {
    if (caught instanceof Bug) return caught.message;
    throw caught;
  }
  return "no throw";
}

test("open_scope_rejects_invalid_parent", () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread, turn } = openTurn(world, { intent: false });
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });

  // 허용 부모 표 밖
  expect(message(() => tasks.openScope(thread, { kind: "tool", id: "x" }))).toStartWith(
    "tasks.invalid_parent",
  );
  expect(message(() => tasks.openScope(tasks.root, { kind: "turn", id: "x" }))).toStartWith(
    "tasks.invalid_parent",
  );
  expect(message(() => tasks.openScope(turn, { kind: "thread", id: "x" }))).toStartWith(
    "tasks.invalid_parent",
  );
  expect(message(() => tasks.openScope(tool, { kind: "tool", id: "x" }))).toStartWith(
    "tasks.invalid_parent",
  );
  // thread 아래 비백그라운드 subagent, turn 아래 백그라운드 subagent
  expect(message(() => tasks.openScope(thread, { kind: "subagent", id: "x" }))).toStartWith(
    "tasks.invalid_parent",
  );
  expect(
    message(() => tasks.openScope(turn, { kind: "subagent", id: "x", background: true })),
  ).toStartWith("tasks.invalid_parent");
  // 백그라운드는 subagent만
  expect(
    message(() => tasks.openScope(turn, { kind: "tool", id: "x", background: true })),
  ).toStartWith("tasks.invalid_parent");
  // 허용되는 조합
  expect(tasks.openScope(thread, { kind: "subagent", id: "bg", background: true }).background).toBe(
    true,
  );
  expect(tasks.openScope(tool, { kind: "subagent", id: "sa" }).background).toBe(false);
});

test("a settled parent rejects new children", async () => {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  await turn.settle();
  expect(() => world.tasks.openScope(turn, { kind: "tool", id: "late" })).toThrow(
    "tasks.parent_settled",
  );
  expect(() => turn.track(Promise.resolve())).toThrow("tasks.scope_settled");
});

test("find returns live nodes only and children are dropped once settled", async () => {
  const world = createWorld();
  const { tasks } = world;
  const { thread, turn, turnId } = openTurn(world, { intent: false });
  const tool = tasks.openScope(turn, { kind: "tool", id: "tc1" });
  expect(tasks.find("turn", turnId)).toBe(turn);
  expect(tasks.find("tool", "tc1")).toBe(tool);
  expect(turn.children()).toEqual([tool]);
  await tool.settle();
  expect(tasks.find("tool", "tc1")).toBeUndefined();
  expect(turn.children()).toEqual([]);
  expect(thread.children()).toEqual([turn]);
});

test("the same tool call id in two turns resolves to the latest live node", async () => {
  const world = createWorld();
  const first = openTurn(world, { intent: false });
  const second = openTurn(world, { intent: false });
  const a = world.tasks.openScope(first.turn, { kind: "tool", id: "call_1" });
  const b = world.tasks.openScope(second.turn, { kind: "tool", id: "call_1" });
  expect(world.tasks.find("tool", "call_1")).toBe(b);
  await b.settle();
  expect(world.tasks.find("tool", "call_1")).toBe(a);
});

test("a scope from another tree is a Bug", () => {
  const world = createWorld();
  const other = createWorld();
  expect(() => world.tasks.openScope(other.tasks.root, { kind: "thread", id: "thr_x" })).toThrow(
    "tasks.invalid_parent",
  );
});
