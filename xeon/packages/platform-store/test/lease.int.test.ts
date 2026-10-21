import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import type { LeaseHolder, LeaseToken } from "@xeon/contracts/records";
import { openStore } from "../src/index.ts";
import { openTestStore, storeFaultAt, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { disposableWith } from "./support/fixture.ts";
import { directOptions } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const SESSION = `session:${THREAD}`;

function holder(id: string, overrides: Partial<LeaseHolder> = {}): LeaseHolder {
  return { holderId: id, kind: "cli", pid: 4242, startedAt: 111, host: "host-a", ...overrides };
}

async function open(
  options: {
    none?: boolean;
    clock?: ManualClock;
    ttl?: number;
    heartbeat?: number;
    busy?: number;
  } = {},
): Promise<{ store: TestStore; clock: ManualClock } & AsyncDisposable> {
  const clock = options.clock ?? manualClock();
  const store = await openTestStore({
    clock,
    scheduler: clock,
    ids: fixedIdFactory(clock),
    settings: {
      leaseTtlMs: options.ttl ?? 30_000,
      heartbeatMs: options.heartbeat ?? 5000,
      busyTimeoutMs: options.busy ?? 5000,
    },
    ...(options.none === true ? { env: { platform: "win32" } } : {}),
  });
  return disposableWith(store, { store, clock });
}

function row(store: TestStore, resource: string): Record<string, unknown> | undefined {
  const result = store.root.read((tx) =>
    tx.get("SELECT * FROM sys_leases WHERE resource = ?", [resource]),
  );
  return result.ok ? result.value : undefined;
}

function token(result: ReturnType<TestStore["service"]["leases"]["acquire"]>): LeaseToken {
  if (!result.ok) throw new Error(`acquire failed: ${result.error.kind}`);
  return result.value;
}

describe("lease acquire", () => {
  test("exactly one acquire wins under contention", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const { leases } = store.service;
    const first = leases.acquire(SESSION, holder("h1"));
    expect(first).toEqual({ ok: true, value: { resource: SESSION, holderId: "h1", epoch: 1 } });
    const second = leases.acquire(SESSION, holder("h2", { pid: 4343 }));
    expect(second).toMatchObject({
      ok: false,
      error: {
        kind: "lock_busy",
        resource: SESSION,
        reason: "os_lock_held",
        owner: { holderId: "h1", epoch: 1, pid: 4242, host: "host-a", kind: "cli" },
      },
    });
  });

  test("the same holder acquiring again keeps its epoch and extends the lease", async () => {
    const fixture = own(await open());
    const { store, clock } = fixture;
    const first = token(store.service.leases.acquire(SESSION, holder("h1")));
    await clock.advance(10_000);
    const again = token(store.service.leases.acquire(SESSION, holder("h1")));
    expect(again).toEqual(first);
    expect(row(store, SESSION)?.["expires_at"]).toBe(clock.now() + 30_000);
  });

  test("invalid resources are bugs", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    expect(() => store.service.leases.acquire("session:not-a-thread", holder("h1"))).toThrow(
      "store.lease_resource_invalid",
    );
    expect(store.service.leases.acquire("scheduler", holder("h1")).ok).toBe(true);
    expect(store.service.leases.acquire("service", holder("h1")).ok).toBe(true);
  });

  test("acquire, renew and release inside a write transaction are bugs", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const t = token(store.service.leases.acquire(SESSION, holder("h1")));
    const { leases } = store.service;
    expect(() => store.root.write(() => leases.acquire("scheduler", holder("h1")))).toThrow(
      "store.nested_write",
    );
    expect(() => store.root.write(() => leases.renew(t))).toThrow("store.nested_write");
    expect(() => store.root.write(() => leases.release(t))).toThrow("store.nested_write");
  });

  test("operations after close are bugs", async () => {
    const { store } = own(await open());
    const t = token(store.service.leases.acquire(SESSION, holder("h1")));
    await store.opened.close();
    expect(() => store.service.leases.acquire("scheduler", holder("h1"))).toThrow("store.closed");
    expect(() => store.service.leases.renew(t)).toThrow("store.closed");
    expect(() => store.service.leases.release(t)).toThrow("store.closed");
  });
});

describe("epoch fencing", () => {
  test("late writer is fenced by epoch", async () => {
    const fixture = own(await open({ none: true }));
    const { store, clock } = fixture;
    const { leases } = store.service;
    const a = token(leases.acquire(SESSION, holder("a")));
    await clock.advance(30_001);
    const b = token(leases.acquire(SESSION, holder("b", { pid: 4343, startedAt: 222 })));
    expect(b.epoch).toBe(a.epoch + 1);
    const holds = (t: LeaseToken): boolean => {
      const result = store.root.write((tx) => leases.holds(tx, t));
      return result.ok && result.value;
    };
    expect(holds(a)).toBe(false);
    expect(holds(b)).toBe(true);
    expect(leases.renew(a)).toEqual({
      ok: false,
      error: { kind: "lease_lost", resource: SESSION },
    });
    expect(leases.renew(b).ok).toBe(true);
    // 늦은 소유자의 반납은 아무것도 바꾸지 않는다
    expect(leases.release(a).ok).toBe(true);
    expect(row(store, SESSION)).toMatchObject({ holder_id: "b", epoch: 2, released_at: null });
  });

  test("release keeps epoch monotonic", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const { leases } = store.service;
    const first = token(leases.acquire(SESSION, holder("h1")));
    expect(leases.release(first).ok).toBe(true);
    expect(row(store, SESSION)).toMatchObject({ epoch: 1 });
    expect(row(store, SESSION)?.["released_at"]).not.toBeNull();
    const second = token(leases.acquire(SESSION, holder("h2")));
    expect(second.epoch).toBe(2);
    expect(leases.release(second).ok).toBe(true);
    expect(token(leases.acquire(SESSION, holder("h1"))).epoch).toBe(3);
  });

  test("a released lease cannot be renewed or held", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const { leases } = store.service;
    const t = token(leases.acquire(SESSION, holder("h1")));
    expect(leases.release(t).ok).toBe(true);
    const holds = store.root.write((tx) => leases.holds(tx, t));
    expect(holds).toEqual({ ok: true, value: false });
    expect(leases.renew(t)).toEqual({
      ok: false,
      error: { kind: "lease_lost", resource: SESSION },
    });
  });

  test("a token for an unknown resource is not held", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const holds = store.root.write((tx) =>
      store.service.leases.holds(tx, { resource: SESSION, holderId: "x", epoch: 1 }),
    );
    expect(holds).toEqual({ ok: true, value: false });
  });
});

describe("without an os lock", () => {
  test("none provider waits for expiry on another host", async () => {
    const fixture = own(await open({ none: true }));
    const { store, clock } = fixture;
    expect(store.opened.warnings).toContainEqual({ kind: "lock_provider_none" });
    expect(store.service.capabilities.lockProvider).toBe("none");
    const { leases } = store.service;
    token(leases.acquire(SESSION, holder("a", { host: "host-a" })));
    const early = leases.acquire(SESSION, holder("b", { host: "host-b" }));
    expect(early).toMatchObject({
      ok: false,
      error: { kind: "lock_busy", reason: "lease_active", owner: { holderId: "a" } },
    });
    await clock.advance(29_999);
    expect(leases.acquire(SESSION, holder("b", { host: "host-b" })).ok).toBe(false);
    await clock.advance(2);
    expect(token(leases.acquire(SESSION, holder("b", { host: "host-b" }))).epoch).toBe(2);
  });

  test("none provider on the same host takes over only when the process is gone", async () => {
    const clock = manualClock();
    let alive = true;
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        env: { platform: "win32", processStartedAt: () => (alive ? 111 : null) },
      }),
    );
    const { leases } = store.service;
    token(leases.acquire(SESSION, holder("a")));
    expect(leases.acquire(SESSION, holder("b", { pid: 4343 }))).toMatchObject({
      ok: false,
      error: { reason: "lease_active" },
    });
    alive = false;
    expect(token(leases.acquire(SESSION, holder("b", { pid: 4343 }))).epoch).toBe(2);
  });

  test("a recycled pid with a different start time counts as gone", async () => {
    const clock = manualClock();
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        env: { platform: "win32", processStartedAt: () => 999 },
      }),
    );
    token(store.service.leases.acquire(SESSION, holder("a", { startedAt: 111 })));
    expect(token(store.service.leases.acquire(SESSION, holder("b"))).epoch).toBe(2);
  });
});

describe("keepAlive", () => {
  test("renews on every heartbeat and stops on dispose", async () => {
    const fixture = own(await open({ heartbeat: 1000, ttl: 3000 }));
    const { store, clock } = fixture;
    const t = token(store.service.leases.acquire(SESSION, holder("h1")));
    const alarm = store.service.leases.keepAlive(t, () => {
      throw new Error("must not be lost");
    });
    await clock.advance(1000);
    expect(row(store, SESSION)?.["expires_at"]).toBe(clock.now() + 3000);
    await clock.advance(5000);
    expect(row(store, SESSION)?.["heartbeat_at"]).toBe(clock.now());
    alarm[Symbol.dispose]();
    expect(clock.pendingTimers()).toEqual([]);
    const stopped = row(store, SESSION)?.["heartbeat_at"];
    await clock.advance(5000);
    expect(row(store, SESSION)?.["heartbeat_at"]).toBe(stopped);
  });

  test("keepAlive reports loss once", async () => {
    const fixture = own(await open({ none: true, heartbeat: 1000, ttl: 3000 }));
    const { store, clock } = fixture;
    const { leases } = store.service;
    const a = token(leases.acquire(SESSION, holder("a")));
    const lost: string[] = [];
    leases.keepAlive(a, (resource) => lost.push(resource));
    // 하트비트가 멈춘 사이 다른 소유자가 만료 뒤 인수한다
    store.root.write((tx) =>
      tx.run("UPDATE sys_leases SET holder_id = 'b', epoch = 2 WHERE resource = ?", [SESSION]),
    );
    await clock.advance(1000);
    await clock.advance(5000);
    expect(lost).toEqual([SESSION]);
    expect(clock.pendingTimers()).toEqual([]);
  });

  test("continuous busy failures longer than the ttl count as lost", async () => {
    const fixture = own(await open({ heartbeat: 1000, ttl: 3000, busy: 0 }));
    const { store, clock } = fixture;
    const t = token(store.service.leases.acquire(SESSION, holder("h1")));
    const lost: string[] = [];
    store.service.leases.keepAlive(t, (resource) => lost.push(resource));
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      // 첫 실패는 1000ms 시점이다. 실패가 TTL(3000ms)보다 오래 이어져야 잃은 것으로 본다
      await clock.advance(1000);
      await clock.advance(1000);
      await clock.advance(1000);
      await clock.advance(1000);
      expect(lost).toEqual([]);
      await clock.advance(1000);
      expect(lost).toEqual([SESSION]);
      expect(clock.pendingTimers()).toEqual([]);
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
  });

  test("a transient busy failure does not count once the heartbeat succeeds again", async () => {
    const fixture = own(await open({ heartbeat: 1000, ttl: 3000, busy: 0 }));
    const { store, clock } = fixture;
    const t = token(store.service.leases.acquire(SESSION, holder("h1")));
    const lost: string[] = [];
    store.service.leases.keepAlive(t, (resource) => lost.push(resource));
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    await clock.advance(2000);
    other.run("ROLLBACK");
    other.close();
    await clock.advance(1000);
    expect(row(store, SESSION)?.["heartbeat_at"]).toBe(clock.now());
    await clock.advance(10_000);
    expect(lost).toEqual([]);
  });
});

describe("inspect", () => {
  test("shows the current owner and nothing after release", async () => {
    const fixture = own(await open());
    const { store, clock } = fixture;
    const { leases } = store.service;
    expect(leases.inspect(SESSION)).toEqual({ ok: true, value: null });
    const t = token(leases.acquire(SESSION, holder("h1")));
    expect(leases.inspect(SESSION)).toEqual({
      ok: true,
      value: {
        holderId: "h1",
        kind: "cli",
        pid: 4242,
        startedAt: 111,
        host: "host-a",
        epoch: 1,
        heartbeatAt: clock.now(),
        expiresAt: clock.now() + 30_000,
      },
    });
    leases.release(t);
    expect(leases.inspect(SESSION)).toEqual({ ok: true, value: null });
  });
});

describe("lease faults and shutdown", () => {
  test("a crash after the os lock releases it and leaves no row", async () => {
    const clock = manualClock();
    const fault = storeFaultAt("lease_after_os_lock");
    fault.armed = false;
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        storeFaults: fault.injector,
      }),
    );
    fault.armed = true;
    expect(() => store.service.leases.acquire(SESSION, holder("h1"))).toThrow(
      "fault:lease_after_os_lock",
    );
    expect(row(store, SESSION)).toBeUndefined();
    fault.armed = false;
    expect(token(store.service.leases.acquire(SESSION, holder("h1"))).epoch).toBe(1);
  });

  test("a crash before the lease commit rolls the row back", async () => {
    const clock = manualClock();
    const fault = storeFaultAt("lease_before_commit");
    fault.armed = false;
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        storeFaults: fault.injector,
      }),
    );
    fault.armed = true;
    expect(() => store.service.leases.acquire(SESSION, holder("h1"))).toThrow(
      "fault:lease_before_commit",
    );
    expect(row(store, SESSION)).toBeUndefined();
    fault.armed = false;
    expect(token(store.service.leases.acquire(SESSION, holder("h1"))).epoch).toBe(1);
  });

  test("close releases every lease so the next owner takes over at once", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const first = directOptions(path);
    const opened = await openStore(first.options);
    if (!opened.ok) throw new Error("open failed");
    const a = token(opened.value.service.leases.acquire(SESSION, holder("a")));
    expect(a.epoch).toBe(1);
    await opened.value.close();

    const second = directOptions(path);
    const reopened = await openStore(second.options);
    if (!reopened.ok) throw new Error("reopen failed");
    expect(token(reopened.value.service.leases.acquire(SESSION, holder("b"))).epoch).toBe(2);
    await reopened.value.close();
  });

  test("two open stores in one process contend through the os lock", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const one = await openStore(directOptions(path).options);
    const two = await openStore(directOptions(path).options);
    if (!one.ok || !two.ok) throw new Error("open failed");
    expect(one.value.service.storeId).toBe(two.value.service.storeId);
    token(one.value.service.leases.acquire(SESSION, holder("a")));
    expect(two.value.service.leases.acquire(SESSION, holder("b"))).toMatchObject({
      ok: false,
      error: { kind: "lock_busy", reason: "os_lock_held", owner: { holderId: "a" } },
    });
    await one.value.close();
    expect(token(two.value.service.leases.acquire(SESSION, holder("b"))).epoch).toBe(2);
    await two.value.close();
  });
});
