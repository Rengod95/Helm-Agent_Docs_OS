import { afterEach, describe, expect, test } from "bun:test";
import type { MigrationSet } from "@xeon/contracts/records";
import { openTestStore, storeFaultAt } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { rejection } from "./support/fixture.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const STEP_1 = "CREATE TABLE cap_knowledge_a (id INTEGER PRIMARY KEY, body TEXT) STRICT";
const STEP_2 = "CREATE TABLE cap_knowledge_b (id INTEGER PRIMARY KEY) STRICT";
const STEP_3 = "CREATE TABLE cap_knowledge_c (id INTEGER PRIMARY KEY) STRICT";

function set(...steps: readonly string[]): MigrationSet {
  return {
    owner: "cap.knowledge",
    version: steps.length,
    steps: steps.map((sql, index) => ({ version: index + 1, sql: [sql] })),
  };
}

async function open(): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  return openTestStore({ clock, ids: fixedIdFactory(clock) });
}

describe("migration runner", () => {
  test("applies steps in order and reports the range", async () => {
    const store = own(await open());
    const first = store.service.migrations.apply(set(STEP_1, STEP_2));
    expect(first).toEqual({ ok: true, value: { owner: "cap.knowledge", from: 0, to: 2 } });
    const again = store.service.migrations.apply(set(STEP_1, STEP_2));
    expect(again).toEqual({ ok: true, value: { owner: "cap.knowledge", from: 2, to: 2 } });
    const more = store.service.migrations.apply(set(STEP_1, STEP_2, STEP_3));
    expect(more).toEqual({ ok: true, value: { owner: "cap.knowledge", from: 2, to: 3 } });
    const counts = await store.rowCounts();
    for (const table of ["cap_knowledge_a", "cap_knowledge_b", "cap_knowledge_c"]) {
      expect(Object.keys(counts)).toContain(table);
    }
  });

  test("migrations apply in order and stop at the failing step", async () => {
    const store = own(await open());
    const result = store.service.migrations.apply(
      set(STEP_1, "INSERT INTO cap_knowledge_missing (a) VALUES (1)", STEP_3),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "migration_failed", owner: "cap.knowledge", version: 2 },
    });
    const counts = await store.rowCounts();
    expect(counts["cap_knowledge_a"]).toBe(0);
    expect(counts["cap_knowledge_c"]).toBeUndefined();
    const applied = store.root.read((tx) =>
      tx.all("SELECT version FROM sys_migrations WHERE owner = 'cap.knowledge'"),
    );
    expect(applied).toEqual({ ok: true, value: [{ version: 1 }] });
  });

  test("a failing step leaves none of its statements behind", async () => {
    const store = own(await open());
    const result = store.service.migrations.apply({
      owner: "cap.knowledge",
      version: 1,
      steps: [{ version: 1, sql: [STEP_1, "CREATE TABLE cap_knowledge_bad (a) STRICT"] }],
    });
    expect(result.ok).toBe(false);
    expect((await store.rowCounts())["cap_knowledge_a"]).toBeUndefined();
  });

  test("migration checksum mismatch is rejected", async () => {
    const store = own(await open());
    expect(store.service.migrations.apply(set(STEP_1)).ok).toBe(true);
    const before = await store.rowCounts();
    const changed = store.service.migrations.apply(
      set(
        "CREATE TABLE cap_knowledge_a (id INTEGER PRIMARY KEY, body TEXT, extra TEXT) STRICT",
        STEP_2,
      ),
    );
    expect(changed).toEqual({
      ok: false,
      error: { kind: "migration_checksum_mismatch", owner: "cap.knowledge", version: 1 },
    });
    expect(await store.rowCounts()).toEqual(before);
  });

  test("future version is reported", async () => {
    const store = own(await open());
    expect(store.service.migrations.apply(set(STEP_1, STEP_2)).ok).toBe(true);
    const older = store.service.migrations.apply(set(STEP_1));
    expect(older).toEqual({
      ok: false,
      error: {
        kind: "migration_future_version",
        owner: "cap.knowledge",
        dbVersion: 2,
        codeVersion: 1,
      },
    });
  });

  test("a gap in the applied versions is reported", async () => {
    const store = own(await open());
    expect(store.service.migrations.apply(set(STEP_1, STEP_2)).ok).toBe(true);
    store.root.write((tx) =>
      tx.run("DELETE FROM sys_migrations WHERE owner = 'cap.knowledge' AND version = 1"),
    );
    expect(store.service.migrations.apply(set(STEP_1, STEP_2))).toEqual({
      ok: false,
      error: { kind: "migration_gap", owner: "cap.knowledge", expected: 1, got: 2 },
    });
  });

  test("invalid step lists and unregistered owners are bugs", async () => {
    const store = own(await open());
    expect(() =>
      store.service.migrations.apply({
        owner: "cap.knowledge",
        version: 2,
        steps: [{ version: 2, sql: [STEP_1] }],
      }),
    ).toThrow("store.migration_set_invalid");
    expect(() =>
      store.service.migrations.apply({ owner: "cap.knowledge", version: 1, steps: [] }),
    ).toThrow("store.migration_set_invalid");
    expect(() =>
      store.service.migrations.apply({
        owner: "ext.nobody",
        version: 1,
        steps: [{ version: 1, sql: ["CREATE TABLE x_nobody_a (a)"] }],
      }),
    ).toThrow("store.prefix_not_owned");
  });

  test("apply inside a write transaction is a bug", async () => {
    const store = own(await open());
    expect(() => store.root.write(() => store.service.migrations.apply(set(STEP_1)))).toThrow(
      "store.nested_write",
    );
  });

  test("a crash after one step resumes at the next step", async () => {
    const clock = manualClock();
    const fault = storeFaultAt("migration_after_step");
    fault.armed = false; // sys 마이그레이션은 장애 없이 지나간다
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        storeFaults: fault.injector,
      }),
    );
    fault.armed = true;
    expect(() => store.service.migrations.apply(set(STEP_1, STEP_2))).toThrow(
      "fault:migration_after_step",
    );
    fault.armed = false;
    expect(store.service.migrations.apply(set(STEP_1, STEP_2))).toEqual({
      ok: true,
      value: { owner: "cap.knowledge", from: 1, to: 2 },
    });
  });

  test("sys migrations are recorded and user_version follows", async () => {
    const store = own(await open());
    const rows = store.root.read((tx) =>
      tx.all("SELECT version FROM sys_migrations WHERE owner = 'sys' ORDER BY version"),
    );
    expect(rows).toEqual({ ok: true, value: [{ version: 1 }, { version: 2 }, { version: 3 }] });
  });

  test("chunked migrations are not available before M2", async () => {
    const store = own(await open());
    const failure = await rejection(
      store.service.migrations.runChunked("cap.knowledge", {
        id: "0001_noop",
        initialCursor: null,
        runChunk: () => ({ next: null, processed: 0 }),
      }),
    );
    expect(String(failure)).toContain("store.not_implemented");
  });
});
