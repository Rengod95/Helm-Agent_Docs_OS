import { afterEach, describe, expect, test } from "bun:test";
import type { FaultInjector, FaultPoint } from "@xeon/contracts/records";
import { faultAt, openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { applyTables } from "./support/migrate.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

/**
 * 확장 저장 영역 계약 시나리오를 실제 bun:sqlite 팩토리로 돌린다(L0.store.plan ST-23, spec §9 18번).
 * X.operations.plan O-15가 만드는 `ext-storage.contract.ts`는 아직 없다. 그 파일이 생기면 이 시나리오 모음을
 * 테스트 파일 교차 import로 바꿔 건다. 지점 이름(`after_ext_projection:<n>`)은 X와 같은 문자열이다.
 */
interface StoreFactory {
  open(faults?: FaultInjector): Promise<TestStore>;
}

const factory: StoreFactory = {
  async open(faults) {
    const clock = manualClock();
    return openTestStore({
      clock,
      ids: fixedIdFactory(clock),
      ...(faults === undefined ? {} : { faults }),
    });
  },
};

async function withExtension(store: TestStore): Promise<void> {
  store.root.write((tx) => {
    tx.run("CREATE TABLE events (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL) STRICT");
  });
  store.service.extensions.register("probe");
  applyTables(store.service, "ext.probe", [
    "CREATE TABLE x_probe_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT",
  ]);
  await Promise.resolve();
}

/** 코어 이벤트 한 건과 확장 투영 한 건을 한 트랜잭션에 쓰는 커밋(투영기 호출 순서를 흉내 낸다) */
function commit(store: TestStore, seq: number): void {
  const projected = store.root.write((tx) => {
    store.faults.hit("after_begin");
    tx.run("INSERT INTO events (seq, kind) VALUES (?, 'x.probe.noted')", [seq]);
    store.faults.hit("after_event_insert:0");
    // 확장 투영기는 같은 트랜잭션 핸들로 자기 접두 테이블에 쓴다(소유 검사는 core-persistence의 ProjectionTx 몫이다)
    tx.run("INSERT INTO x_probe_items (label) VALUES ('n')");
    store.faults.hit("after_ext_projection:0");
  });
  if (!projected.ok) throw new Error("write failed");
}

describe("extension storage contract on bun:sqlite", () => {
  test("extension storage contract runs on bun:sqlite", async () => {
    const store = own(await factory.open());
    await withExtension(store);
    const scoped = store.service.scoped("ext.probe");
    expect(scoped.write((tx) => tx.run("INSERT INTO x_probe_items (label) VALUES ('a')")).ok).toBe(
      true,
    );
    expect(scoped.read((tx) => tx.all("SELECT label FROM x_probe_items"))).toEqual({
      ok: true,
      value: [{ label: "a" }],
    });
  });

  test("an extension cannot touch core tables or other extensions", async () => {
    const store = own(await factory.open());
    await withExtension(store);
    store.service.extensions.register("other");
    applyTables(store.service, "ext.other", [
      "CREATE TABLE x_other_items (id INTEGER PRIMARY KEY) STRICT",
    ]);
    const scoped = store.service.scoped("ext.probe");
    expect(() => scoped.read((tx) => tx.all("SELECT * FROM events"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(() => scoped.write((tx) => tx.run("DELETE FROM x_other_items"))).toThrow(
      "store.prefix_not_owned",
    );
  });

  test("projection writes commit with the core event", async () => {
    const store = own(await factory.open());
    await withExtension(store);
    commit(store, 1);
    const counts = await store.rowCounts();
    expect(counts["events"]).toBe(1);
    expect(counts["x_probe_items"]).toBe(1);
  });

  test("storage contract: rollback discards extension writes", async () => {
    const fault = faultAt("after_ext_projection:0");
    fault.armed = false;
    const store = own(await factory.open(fault.injector));
    await withExtension(store);
    commit(store, 1);
    const counts = await store.rowCounts();
    const digests = await store.rowDigests();
    fault.armed = true;
    const point: FaultPoint = "after_ext_projection:0";
    expect(() => commit(store, 2)).toThrow(`fault:${point}`);
    expect(await store.rowCounts()).toEqual(counts);
    expect(await store.rowDigests()).toEqual(digests);
  });

  test("removing an extension drops its tables and keeps the events", async () => {
    const store = own(await factory.open());
    await withExtension(store);
    commit(store, 1);
    expect(store.service.extensions.drop("probe", ["x_probe_items"])).toEqual({
      ok: true,
      value: { dropped: ["x_probe_items"] },
    });
    const counts = await store.rowCounts();
    expect(counts["events"]).toBe(1);
    expect(counts["x_probe_items"]).toBeUndefined();
    expect(() => store.service.scoped("ext.probe")).toThrow("store.prefix_not_owned");
  });
});
