import { expect, test } from "bun:test";
import { createSmokeGroup, createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

test("a restarted host picks up enabled scopes, state and the open lease", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  const a = createSmokeGroup({ ids: first.ids });
  await first.host.install(a.unit);
  await first.host.openThread(thread);
  await first.settled();
  expect(first.loop.turns).toHaveLength(1);
  const acquiredBefore = first.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquiredBefore).toHaveLength(1);

  // 프로세스 재시작: 같은 저장소와 루프 기록으로 새 호스트를 만든다
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  const b = createSmokeGroup({ ids: second.ids, driveTurns: 1 });
  await second.host.install(b.unit);
  await second.host.openThread(thread);
  await second.settled();
  const snapshot = await second.records.loadThread(thread);
  expect(snapshot.states.map((state) => state.doc)).toEqual([{ count: 1 }]);
  // 새 임대를 만들지 않고 열린 임대로 이어 간다. 이미 count가 1이라 drive는 아무 일도 하지 않는다
  const acquiredAfter = second.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquiredAfter).toHaveLength(1);
  expect(second.loop.turns).toHaveLength(1);
  expect(second.host.scopes()[0]).toMatchObject({ status: "enabled", drive: "holding" });
});

test("the drive function is re-invoked after a restart with the same request key", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  const keys: string[] = [];
  const unitOf = () =>
    makeGroupUnit({ name: "res-replay" }, (g) => {
      g.drive(async (loop) => {
        const outcome = await loop.turn({ input: { kind: "user", content: "go" } });
        keys.push(String(outcome.turnId));
      });
    });
  await first.host.install(unitOf());
  await first.host.openThread(thread);
  await first.settled();
  expect(first.loop.turns).toHaveLength(1);

  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await second.host.install(unitOf());
  await second.host.openThread(thread);
  await second.settled();
  // 열린 임대로 다시 불렸고, 같은 상태 판(0)이라 같은 requestId로 replayed가 되어 새 turn은 없다
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(first.loop.turns).toHaveLength(1);
});

test("an open lease whose scope is gone is released with restart", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(createSmokeGroup({ ids: first.ids }).unit);
  await first.host.openThread(thread);
  await first.settled();

  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  // 스모크 그룹을 설치하지 않은 채 thread를 연다
  await second.host.openThread(thread);
  await second.settled();
  const events = second.records.events(thread);
  const released = events.filter((event) => event.kind === "lease.released");
  expect(released).toHaveLength(1);
  expect(released[0]?.payload).toMatchObject({ reason: "restart", scopeId: "smoke-group" });
  const changed = events.filter((event) => event.kind === "scope.changed").map((e) => e.payload);
  expect(changed).toEqual([
    { scopeId: "smoke-group", status: "enabled" },
    { scopeId: "smoke-group", status: "disabled" },
  ]);
});
