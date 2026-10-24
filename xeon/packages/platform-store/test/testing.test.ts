import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { LeaseHolder } from "@xeon/contracts/records";
import * as entry from "../src/index.ts";
import {
  NO_STORE_FAULTS,
  STORE_FAULT_POINTS,
  faultAt,
  openTestStore,
  storeFaultAt,
} from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, seededRandom } from "./support/clock.ts";
import { rejection } from "./support/fixture.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const holder = (id: string): LeaseHolder => ({
  holderId: id,
  kind: "cli",
  pid: 1,
  startedAt: 1,
  host: "test-machine",
});

describe("package entry", () => {
  test("platform-store entry loads", () => {
    expect(typeof entry.openStore).toBe("function");
    expect(typeof entry.storePlugin).toBe("function");
    expect(typeof entry.resolveStoreSettings).toBe("function");
    expect(entry.DEFAULT_STORE_SETTINGS.heartbeatMs).toBe(5000);
  });
});

describe("openTestStore", () => {
  test("removes the temporary directory it created", async () => {
    const clock = manualClock();
    const store = await openTestStore({ clock, ids: fixedIdFactory(clock) });
    const dir = dirname(store.path);
    expect(existsSync(store.path)).toBe(true);
    await store[Symbol.asyncDispose]();
    expect(existsSync(dir)).toBe(false);
  });

  test("keeps a directory the caller provided", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const store = await openTestStore({
      path: dir.join("keep.db"),
      clock,
      ids: fixedIdFactory(clock),
    });
    await store[Symbol.asyncDispose]();
    expect(existsSync(dir.join("keep.db"))).toBe(true);
  });

  test("a failing open surfaces as a bug", async () => {
    const clock = manualClock();
    const failure = await rejection(
      openTestStore({ path: "relative.db", clock, ids: fixedIdFactory(clock) }),
    );
    expect(String(failure)).toContain("db_path_invalid");
  });

  test("row digests change with the rows and ignore row order", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    store.root.write((tx) => {
      tx.run("CREATE TABLE p_probe (a TEXT, b BLOB) STRICT");
      tx.run("INSERT INTO p_probe (a, b) VALUES ('1', x'00')");
      tx.run("INSERT INTO p_probe (a, b) VALUES ('2', NULL)");
    });
    const before = await store.rowDigests();
    expect(before["p_probe"]).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.rowDigests()).toEqual(before);
    store.root.write((tx) => tx.run("INSERT INTO p_probe (a, b) VALUES ('3', NULL)"));
    expect((await store.rowDigests())["p_probe"]).not.toBe(before["p_probe"]);
    expect((await store.rowCounts())["p_probe"]).toBe(3);
  });

  test("without a scheduler the lease heartbeat timer is inert", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    const token = store.service.leases.acquire("scheduler", {
      holderId: "h1",
      kind: "cli",
      pid: 1,
      startedAt: 1,
      host: "test-machine",
    });
    if (!token.ok) throw new Error("acquire failed");
    const alarm = store.service.leases.keepAlive(token.value, () => {
      throw new Error("an inert timer never fires");
    });
    alarm[Symbol.dispose]();
    expect(clock.pendingTimers()).toEqual([]);
  });

  test("the default environment treats other pids as gone when there is no os lock", async () => {
    const clock = manualClock();
    const store = own(
      await openTestStore({ clock, ids: fixedIdFactory(clock), env: { platform: "win32" } }),
    );
    expect(store.service.leases.acquire("service", holder("a")).ok).toBe(true);
    expect(store.service.leases.acquire("service", holder("b"))).toEqual({
      ok: true,
      value: { resource: "service", holderId: "b", epoch: 2 },
    });
  });

  test("fault helpers throw only at their point while armed", () => {
    const fault = faultAt("before_commit");
    expect(() => fault.injector.hit("after_begin")).not.toThrow();
    expect(() => fault.injector.hit("before_commit")).toThrow("fault:before_commit");
    fault.armed = false;
    expect(() => fault.injector.hit("before_commit")).not.toThrow();
    const store = storeFaultAt("blob_before_row");
    expect(() => store.injector.hit("blob_after_rename")).not.toThrow();
    expect(() => store.injector.hit("blob_before_row")).toThrow("fault:blob_before_row");
    expect(() => NO_STORE_FAULTS.hit("blob_before_row")).not.toThrow();
    expect(STORE_FAULT_POINTS).toHaveLength(7);
  });
});

describe("test doubles", () => {
  test("manualClock runs due timers in order and supports clearing", async () => {
    const clock = manualClock(1000);
    const ran: string[] = [];
    clock.setTimeout(() => ran.push("b"), 20);
    clock.setTimeout(() => ran.push("a"), 10);
    const dropped = clock.setTimeout(() => ran.push("x"), 15);
    clock.clearTimeout(dropped);
    expect(clock.pendingTimers()).toEqual([{ at: 1010 }, { at: 1020 }]);
    await clock.advance(25);
    expect(ran).toEqual(["a", "b"]);
    expect(clock.now()).toBe(1025);
    await clock.set(5);
    expect(clock.now()).toBe(5);
    await clock.set(50);
    expect(clock.now()).toBe(50);
  });

  test("fixedIdFactory makes valid unique ids and seededRandom is repeatable", () => {
    const clock = manualClock();
    const ids = fixedIdFactory(clock, "s");
    const first = ids.next("thr");
    const second = ids.next("thr");
    expect(first).toMatch(/^thr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(second).not.toBe(first);
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
