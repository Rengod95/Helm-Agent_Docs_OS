import { expect, test } from "bun:test";
import { createHarness, LeaseCell, MemoryStore, MINUTE, SECOND } from "./support/harness.ts";

// L2.schedule.spec §4.4.3. 두 프로세스가 같은 저장소와 같은 leader 임대를 두고 틱을 돌린다.
// 임대를 쥔 쪽만 실행하고, 죽은 leader는 임대 만료 뒤 다른 쪽이 대체한다.

const EVERY_10_MIN = { kind: "interval", everySeconds: 600 } as const;

function pair() {
  const cell = new LeaseCell();
  const store = new MemoryStore();
  const clock = { now: 1_000_000_000_000 };
  const a = createHarness({ store, clock, leader: cell.forWorker("A"), idPrefix: "a" });
  const b = createHarness({ store, clock, leader: cell.forWorker("B"), idPrefix: "b" });
  return { cell, store, clock, a, b };
}

test("only the process holding the lease fires a due entry, and the other never starts a run", async () => {
  const { cell, clock, a, b } = pair();
  expect((await a.service.start()).ok).toBe(true);
  expect((await b.service.start()).ok).toBe(true);
  expect(cell.owner).toBe("A");

  const created = await a.service.create({ trigger: EVERY_10_MIN, prompt: "once" });
  expect(created.ok).toBe(true);
  clock.now += 600 * SECOND;
  await a.service.tick();
  await b.service.tick();

  expect(a.runner.started.map((run) => run.request.prompt)).toEqual(["once"]);
  expect(b.runner.started).toEqual([]);
});

test("a dead leader is replaced once its lease expires, and the entry fires exactly once across both", async () => {
  const { cell, clock, a, b } = pair();
  await a.service.start();
  await b.service.start();
  const created = await a.service.create({ trigger: EVERY_10_MIN, prompt: "tick" });
  if (!created.ok) throw new Error("create failed");

  // A는 죽었다: 더 틱을 돌리지 않고 임대는 만료된다
  cell.expire();
  clock.now += 600 * SECOND;
  await b.service.tick();

  expect(cell.owner).toBe("B");
  expect(a.runner.started).toEqual([]);
  expect(b.runner.started.map((run) => run.request.requestId)).toEqual([
    `${created.value.id}:${clock.now}`,
  ]);
  // B가 계속 틱을 돌려도 같은 기한을 다시 실행하지 않는다
  clock.now += 10 * SECOND;
  await b.service.tick();
  expect(b.runner.started).toHaveLength(1);
});

test("a leader that loses the lease stops firing and the new leader takes the entry", async () => {
  const { cell, clock, a, b } = pair();
  await a.service.start();
  await b.service.start();
  const created = await a.service.create({ trigger: EVERY_10_MIN, prompt: "tick" });
  if (!created.ok) throw new Error("create failed");

  cell.steal("B");
  clock.now += 600 * SECOND;
  await a.service.tick();
  expect(a.runner.started).toEqual([]);
  await b.service.tick();
  expect(b.runner.started).toHaveLength(1);
  expect(a.runner.started).toHaveLength(0);
});

test("the leader picks up an entry another process created after it took the lease", async () => {
  const { clock, a, b } = pair();
  await a.service.start();
  await b.service.start();
  // B가 만든 항목은 저장소에만 있고 A의 메모리에는 없다
  const created = await b.service.create({ trigger: EVERY_10_MIN, prompt: "from B" });
  if (!created.ok) throw new Error("create failed");
  expect(a.service.list()).toEqual([]);

  clock.now += 600 * SECOND;
  await a.service.tick();
  expect(a.runner.started.map((run) => run.request.prompt)).toEqual(["from B"]);
  expect(b.runner.started).toEqual([]);
});

test("a new leader closes the dead leader's started run as host_exit and does not rerun it", async () => {
  const { cell, clock, a, b } = pair();
  await a.service.start();
  await b.service.start();
  const created = await a.service.create({ trigger: EVERY_10_MIN, prompt: "long" });
  if (!created.ok) throw new Error("create failed");
  clock.now += 600 * SECOND;
  await a.service.tick();
  expect(a.runner.started).toHaveLength(1);

  cell.expire();
  clock.now += 1 * MINUTE;
  await b.service.tick();
  expect(b.service.runs(created.value.id)[0]).toMatchObject({
    status: "failed",
    reason: "host_exit",
  });
  expect(b.runner.started).toEqual([]);
});

test("without a leader the service ticks on its own as before", async () => {
  const h = createHarness();
  await h.service.start();
  const created = await h.service.create({ trigger: EVERY_10_MIN, prompt: "solo" });
  expect(created.ok).toBe(true);
  h.clock.now += 600 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
});
