import { expect, test } from "bun:test";
import type { AbortReason, KeyedQueue, TaskScope } from "@xeon/contracts/services";
import { createWorld, deferred, flush, openTurn, type Deferred } from "./support/world.ts";

interface Fixture {
  readonly locks: KeyedQueue;
  readonly owners: () => TaskScope;
  readonly log: string[];
}

function fixture(): Fixture {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  let next = 0;
  return {
    locks: world.tasks.locks,
    owners: () => {
      next += 1;
      return world.tasks.openScope(turn, { kind: "tool", id: `tc${next}` });
    },
    log: [],
  };
}

/** 작업 하나: 시작과 끝을 기록하고 gate가 열릴 때까지 쥔다 */
function job(log: string[], name: string, gate: Deferred<void>): () => Promise<string> {
  return async () => {
    log.push(`start ${name}`);
    await gate.promise;
    log.push(`end ${name}`);
    return name;
  };
}

test("keyed_queue_serializes_same_realpath", async () => {
  const { locks, owners, log } = fixture();
  const gateA = deferred<void>();
  const gateB = deferred<void>();
  const gateC = deferred<void>();
  const a = locks.run([{ key: "/a", mode: "exclusive" }], owners(), job(log, "a", gateA));
  const b = locks.run([{ key: "/a", mode: "exclusive" }], owners(), job(log, "b", gateB));
  const c = locks.run([{ key: "/c", mode: "exclusive" }], owners(), job(log, "c", gateC));
  await flush();
  // 같은 키의 b는 a가 끝나기를 기다리고 다른 키의 c는 곧바로 겹쳐 실행된다
  expect(log).toEqual(["start a", "start c"]);
  gateA.resolve();
  await a;
  await flush();
  expect(log).toEqual(["start a", "start c", "end a", "start b"]);
  gateB.resolve();
  gateC.resolve();
  expect(await Promise.all([b, c])).toEqual(["b", "c"]);
  expect(log.indexOf("end a")).toBeLessThan(log.indexOf("start b"));
});

test("keyed_queue_shared_then_exclusive", async () => {
  const { locks, owners, log } = fixture();
  const gates = {
    r1: deferred<void>(),
    r2: deferred<void>(),
    w: deferred<void>(),
    r3: deferred<void>(),
  };
  const r1 = locks.run([{ key: "/f", mode: "shared" }], owners(), job(log, "r1", gates.r1));
  const r2 = locks.run([{ key: "/f", mode: "shared" }], owners(), job(log, "r2", gates.r2));
  const w = locks.run([{ key: "/f", mode: "exclusive" }], owners(), job(log, "w", gates.w));
  // exclusive가 기다리는 동안 뒤의 shared도 기다린다(쓰기 굶주림 방지)
  const r3 = locks.run([{ key: "/f", mode: "shared" }], owners(), job(log, "r3", gates.r3));
  await flush();
  expect(log).toEqual(["start r1", "start r2"]);
  gates.r1.resolve();
  await r1;
  await flush();
  expect(log).toEqual(["start r1", "start r2", "end r1"]);
  gates.r2.resolve();
  await r2;
  await flush();
  expect(log.slice(-2)).toEqual(["end r2", "start w"]);
  gates.w.resolve();
  await w;
  await flush();
  expect(log.slice(-2)).toEqual(["end w", "start r3"]);
  gates.r3.resolve();
  await r3;
});

test("keyed_queue_abort_removes_waiter", async () => {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  const holder = world.tasks.openScope(turn, { kind: "tool", id: "holder" });
  const waiting = world.tasks.openScope(turn, { kind: "tool", id: "waiting" });
  const behind = world.tasks.openScope(turn, { kind: "tool", id: "behind" });
  const { locks } = world.tasks;
  const log: string[] = [];
  const gate = deferred<void>();
  const run1 = locks.run([{ key: "/f", mode: "exclusive" }], holder, job(log, "holder", gate));
  const run2 = locks.run([{ key: "/f", mode: "exclusive" }], waiting, job(log, "waiting", gate));
  const gateBehind = deferred<void>();
  gateBehind.resolve();
  const run3 = locks.run([{ key: "/f", mode: "shared" }], behind, job(log, "behind", gateBehind));
  await flush();
  expect(locks.pending("/f")).toBe(3);

  const reason: AbortReason = { code: "user", message: "cancel" };
  await world.tasks.abort(waiting, reason);
  const rejected = await run2.then(
    () => "resolved",
    (caught: unknown) => caught,
  );
  // signal.reason(AbortReason)으로 거부된다
  expect(rejected).toBe(reason);
  expect(locks.pending("/f")).toBe(2);

  gate.resolve();
  await run1;
  expect(await run3).toBe("behind");
  // 취소된 작업은 한 번도 시작하지 않았다
  expect(log).toEqual(["start holder", "end holder", "start behind", "end behind"]);
  expect(locks.pending("/f")).toBe(0);
});

test("an already aborted owner is rejected without taking the lock", async () => {
  const world = createWorld();
  const { turn } = openTurn(world, { intent: false });
  const tool = world.tasks.openScope(turn, { kind: "tool", id: "tc" });
  const reason: AbortReason = { code: "user", message: null };
  const running = deferred<void>();
  const held = tool.track(running.promise);
  await world.tasks.abort(tool, reason);
  const rejected = await world.tasks.locks
    .run([{ key: "/f", mode: "exclusive" }], tool, async () => "never")
    .then(
      () => "resolved",
      (caught: unknown) => caught,
    );
  expect(rejected).toBe(reason);
  expect(world.tasks.locks.pending("/f")).toBe(0);
  running.resolve();
  await held;
});

test("keyed_queue_multi_key_no_deadlock", async () => {
  const { locks, owners } = fixture();
  const gateAB = deferred<void>();
  const gateBA = deferred<void>();
  const log: string[] = [];
  // 같은 키 집합을 반대 순서로 요청해도 사전순으로 얻어 순환 대기가 생기지 않는다
  const ab = locks.run(
    [
      { key: "a", mode: "exclusive" },
      { key: "b", mode: "exclusive" },
    ],
    owners(),
    job(log, "ab", gateAB),
  );
  const ba = locks.run(
    [
      { key: "b", mode: "exclusive" },
      { key: "a", mode: "exclusive" },
    ],
    owners(),
    job(log, "ba", gateBA),
  );
  await flush();
  expect(log).toEqual(["start ab"]);
  gateAB.resolve();
  await ab;
  await flush();
  gateBA.resolve();
  expect(await ba).toBe("ba");
  expect(log).toEqual(["start ab", "end ab", "start ba", "end ba"]);
});

test("a duplicate key in one request is taken once, with the stronger mode", async () => {
  const { locks, owners } = fixture();
  const log: string[] = [];
  const gate = deferred<void>();
  gate.resolve();
  const result = await locks.run(
    [
      { key: "/f", mode: "shared" },
      { key: "/f", mode: "exclusive" },
    ],
    owners(),
    job(log, "once", gate),
  );
  expect(result).toBe("once");
  expect(locks.pending("/f")).toBe(0);
});

test("a throwing job releases every lock and rethrows", async () => {
  const { locks, owners } = fixture();
  const failure = new Error("boom");
  const failed = await locks
    .run(
      [
        { key: "/a", mode: "exclusive" },
        { key: "/b", mode: "shared" },
      ],
      owners(),
      async () => {
        throw failure;
      },
    )
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  expect(failed).toBe(failure);
  expect(locks.pending("/a")).toBe(0);
  expect(locks.pending("/b")).toBe(0);
  expect(await locks.run([{ key: "/a", mode: "exclusive" }], owners(), async () => 1)).toBe(1);
});
