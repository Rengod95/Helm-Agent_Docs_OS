import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { AbortReason, Slot, TaskScope } from "@xeon/contracts/services";
import { createWorld, deferred, flush, openTurn, type World } from "./support/world.ts";

const USER_STOP: AbortReason = { code: "user", message: "stop" };

function toolNode(world: World, id: string): TaskScope {
  const { turn } = openTurn(world, { intent: false });
  return world.tasks.openScope(turn, { kind: "tool", id });
}

/** 풀에 상한을 건 세계 */
function capped(limits: { tools?: number; subagents?: number; modelCalls?: number }): World {
  return createWorld({ settings: { limits } });
}

describe("limiter", () => {
  test("slots are counted against the capacity setting and released by the owner's settling", async () => {
    const world = capped({ tools: 2 });
    const limiter = world.tasks.limiter("tools");
    expect(limiter.pool).toBe("tools");
    expect(limiter.capacity()).toBe(2);
    const tool = toolNode(world, "tc1");
    const slot = await limiter.acquire(tool);
    expect(limiter.inUse()).toBe(1);
    slot.release();
    slot.release();
    expect(limiter.inUse()).toBe(0);
    await limiter.acquire(tool);
    expect(limiter.inUse()).toBe(1);
    await tool.settle();
    expect(limiter.inUse()).toBe(0);
    expect(world.tasks.limiter("subagents")).not.toBe(limiter);
    expect(createWorld().tasks.limiter("tools").capacity()).toBe(8);
    expect(createWorld().tasks.limiter("subagents").capacity()).toBe(16);
    expect(createWorld().tasks.limiter("modelCalls").capacity()).toBe(16);
  });

  // spec plan limiter_blocks_over_cap_and_dequeues_on_abort
  test("limiter_blocks_over_cap_and_dequeues_on_abort: the third waits, an abort removes it, a release hands over in FIFO order", async () => {
    const world = capped({ tools: 2 });
    const limiter = world.tasks.limiter("tools");
    const { turn } = openTurn(world, { intent: false });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) =>
      world.tasks.openScope(turn, { kind: "tool", id }),
    );
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Bug("test scopes missing");
    }
    const first = await limiter.acquire(a);
    await limiter.acquire(b);
    const order: string[] = [];
    const waitingC = limiter.acquire(c).then((slot) => {
      order.push("c");
      return slot;
    });
    const waitingD = limiter.acquire(d).then((slot) => {
      order.push("d");
      return slot;
    });
    await flush();
    expect(limiter.inUse()).toBe(2);
    expect(limiter.waiting()).toBe(2);
    // 대기 중 취소는 대기열에서 빠지고 AbortReason으로 거부한다
    const cancelled = waitingC.then(
      () => null,
      (caught: unknown) => caught,
    );
    await world.tasks.abort(c, USER_STOP);
    expect(await cancelled).toEqual(USER_STOP);
    expect(limiter.waiting()).toBe(1);
    expect(order).toEqual([]);
    first.release();
    const slotD = await waitingD;
    expect(order).toEqual(["d"]);
    expect(limiter.inUse()).toBe(2);
    slotD.release();
  });

  // spec plan limiter_slot_reentry_is_bug
  test("limiter_slot_reentry_is_bug: a node that holds a slot cannot take a second one in the same pool", async () => {
    const world = capped({ tools: 4 });
    const limiter = world.tasks.limiter("tools");
    const tool = toolNode(world, "tc1");
    const slot = await limiter.acquire(tool);
    const second = await limiter.acquire(tool).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(second).toBeInstanceOf(Bug);
    expect(String(second)).toContain("tasks.slot_reentry");
    // 반납한 뒤에는 다시 얻을 수 있다. 다른 풀은 따로 센다
    slot.release();
    await limiter.acquire(tool);
    await world.tasks.limiter("subagents").acquire(tool);
  });

  // spec plan limiter_capacity_change_applies_to_new_acquire
  test("limiter_capacity_change_applies_to_new_acquire: shrinking keeps held slots, new acquires obey the new cap", async () => {
    const limits = { tools: 3 };
    const world = capped(limits);
    const limiter = world.tasks.limiter("tools");
    const { turn } = openTurn(world, { intent: false });
    const nodes = ["a", "b", "c", "d"].map((id) =>
      world.tasks.openScope(turn, { kind: "tool", id }),
    );
    const held: Slot[] = await Promise.all(nodes.slice(0, 3).map((node) => limiter.acquire(node)));
    expect(limiter.inUse()).toBe(3);
    // 설정을 읽는 쪽이 값을 줄인다: 설정 소스는 호출 때마다 읽힌다
    const shrunk = createWorld({
      settingsSource: {
        steeringMode: () => "one-at-a-time",
        followUpMode: () => "one-at-a-time",
        limit: () => 1,
      },
    });
    const tight = shrunk.tasks.limiter("tools");
    const x = toolNode(shrunk, "x");
    const slot = await tight.acquire(x);
    const waiting = tight.acquire(toolNode(shrunk, "y"));
    await flush();
    expect(tight.waiting()).toBe(1);
    slot.release();
    await waiting;
    expect(tight.inUse()).toBe(1);
    for (const slotHeld of held) slotHeld.release();
  });

  // spec plan limiter_no_deadlock_parent_waits_child
  test("limiter_no_deadlock_parent_waits_child: tools and subagents capped at 1 still settle a depth-3 chain (C2 suspendWhile)", async () => {
    const world = capped({ tools: 1, subagents: 1 });
    const tools = world.tasks.limiter("tools");
    const subagents = world.tasks.limiter("subagents");
    const { turn } = openTurn(world, { intent: false });

    // 도구 -> 자식 -> 도구 -> 손자: 각 단계가 자기 슬롯을 내려놓고 아래 단계의 정착을 기다린다
    async function level(parent: TaskScope, depth: number): Promise<string> {
      const tool = world.tasks.openScope(parent, { kind: "tool", id: `tool-${String(depth)}` });
      const toolSlot = await tools.acquire(tool);
      if (depth === 3) {
        toolSlot.release();
        return "leaf";
      }
      const child = world.tasks.openScope(tool, {
        kind: "subagent",
        id: `thr_child_${String(depth)}`,
      });
      const childSlot = await subagents.acquire(child);
      const childTurn = world.tasks.openScope(child, {
        kind: "turn",
        id: `trn_child_${String(depth)}`,
      });
      // 자식이 아래 단계(손자까지)를 기다리는 동안 두 슬롯을 모두 내려놓는다
      const below = await toolSlot.suspendWhile(
        childSlot.suspendWhile(level(childTurn, depth + 1)),
      );
      childSlot.release();
      toolSlot.release();
      return `${String(depth)}>${below}`;
    }

    const result = await level(turn, 1);
    expect(result).toBe("1>2>leaf");
    expect(tools.inUse()).toBe(0);
    expect(subagents.inUse()).toBe(0);
  });

  test("suspendWhile re-queues FIFO behind others and does not retake a slot after the owner settled", async () => {
    const world = capped({ tools: 1 });
    const limiter = world.tasks.limiter("tools");
    const { turn } = openTurn(world, { intent: false });
    const a = world.tasks.openScope(turn, { kind: "tool", id: "a" });
    const b = world.tasks.openScope(turn, { kind: "tool", id: "b" });
    const slotA = await limiter.acquire(a);
    const wait = deferred<string>();
    const suspended = slotA.suspendWhile(wait.promise);
    expect(limiter.inUse()).toBe(0);
    const slotB = await limiter.acquire(b);
    wait.resolve("done");
    await flush();
    // b가 쥐고 있어 a는 대기열에 선다
    expect(limiter.waiting()).toBe(1);
    slotB.release();
    expect(await suspended).toBe("done");
    expect(limiter.inUse()).toBe(1);
    await a.settle();
    expect(limiter.inUse()).toBe(0);
  });

  test("an already aborted owner is refused with its abort reason and takes no slot", async () => {
    const world = capped({ modelCalls: 1 });
    const { turn } = openTurn(world, { intent: false });
    const running = deferred<void>();
    const held = turn.track(running.promise);
    await world.tasks.abort(turn, USER_STOP);
    const rejected = await world.tasks
      .limiter("modelCalls")
      .acquire(turn)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(rejected).toEqual(USER_STOP);
    expect(world.tasks.limiter("modelCalls").inUse()).toBe(0);
    running.resolve();
    await held;
  });
});

describe("subagent pool (TK-9)", () => {
  // 렌즈 N개 탐구: 자식 N개가 subagents 풀을 나눠 쓴다
  test("eight lens-like children share a pool of three and all settle with at most three running", async () => {
    const world = capped({ subagents: 3 });
    const pool = world.tasks.limiter("subagents");
    const { turn } = openTurn(world, { intent: false });
    let running = 0;
    let peak = 0;
    const settledOrder: number[] = [];
    const children = Array.from({ length: 8 }, (_, index) => index).map(async (index) => {
      const child = world.tasks.openScope(turn, {
        kind: "subagent",
        id: `thr_lens_${String(index)}`,
      });
      const slot = await pool.acquire(child);
      running += 1;
      peak = Math.max(peak, running);
      await flush(3);
      running -= 1;
      slot.release();
      settledOrder.push(index);
    });
    await Promise.all(children);
    expect(peak).toBe(3);
    expect(settledOrder).toHaveLength(8);
    // 대기열은 FIFO라 먼저 요청한 자식이 먼저 실행한다
    expect(settledOrder.slice(0, 3)).toEqual([0, 1, 2]);
    expect(pool.inUse()).toBe(0);
    expect(pool.waiting()).toBe(0);
  });

  test("aborting the parent turn clears every queued child from the pool", async () => {
    const world = capped({ subagents: 1 });
    const pool = world.tasks.limiter("subagents");
    const { turn } = openTurn(world, { intent: false });
    const holder = world.tasks.openScope(turn, { kind: "subagent", id: "thr_holder" });
    const slot = await pool.acquire(holder);
    const queued = ["a", "b", "c"].map((id) =>
      pool.acquire(world.tasks.openScope(turn, { kind: "subagent", id: `thr_${id}` })).then(
        () => "got",
        () => "aborted",
      ),
    );
    await flush();
    expect(pool.waiting()).toBe(3);
    await world.tasks.abort(turn, USER_STOP);
    expect(await Promise.all(queued)).toEqual(["aborted", "aborted", "aborted"]);
    expect(pool.waiting()).toBe(0);
    slot.release();
    expect(pool.inUse()).toBe(0);
  });
});
