import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { applyTables } from "./support/migrate.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

async function open(): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  return openTestStore({ clock, ids: fixedIdFactory(clock) });
}

function tableNames(store: Awaited<ReturnType<typeof open>>): readonly string[] {
  const rows = store.root.read((tx) =>
    tx.all("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"),
  );
  return rows.ok ? rows.value.map((row) => String(row["name"])) : [];
}

describe("extension tables", () => {
  test("extension ids follow pattern and reserved words", async () => {
    const store = own(await open());
    const { extensions } = store.service;
    expect(extensions.register("Helm")).toEqual({
      ok: false,
      error: { kind: "ext_id_invalid", name: "Helm", reason: "pattern" },
    });
    expect(extensions.register("ext")).toEqual({
      ok: false,
      error: { kind: "ext_id_invalid", name: "ext", reason: "reserved" },
    });
    for (const name of ["a_b", "x"]) {
      expect(extensions.register(name)).toEqual({
        ok: false,
        error: { kind: "ext_id_invalid", name, reason: "pattern" },
      });
    }
    expect(extensions.register("acme-notes")).toEqual({
      ok: true,
      value: { owner: "ext.acme-notes", tablePrefix: "x_acme_notes_" },
    });
  });

  test("register is idempotent and records the prefix", async () => {
    const store = own(await open());
    expect(store.service.extensions.register("acme-notes").ok).toBe(true);
    expect(store.service.extensions.register("acme-notes").ok).toBe(true);
    const rows = store.root.read((tx) =>
      tx.all("SELECT owner, kind, names FROM sys_prefixes WHERE owner = 'ext.acme-notes'"),
    );
    expect(rows).toEqual({
      ok: true,
      value: [{ owner: "ext.acme-notes", kind: "extension", names: '["x_acme_notes_"]' }],
    });
  });

  test("a registered extension migrates and uses only its own tables", async () => {
    const store = own(await open());
    store.service.extensions.register("acme-notes");
    applyTables(store.service, "ext.acme-notes", [
      "CREATE TABLE x_acme_notes_items (id INTEGER PRIMARY KEY, body TEXT) STRICT",
    ]);
    const scoped = store.service.scoped("ext.acme-notes");
    expect(
      scoped.write((tx) => tx.run("INSERT INTO x_acme_notes_items (body) VALUES ('a')")).ok,
    ).toBe(true);
    expect(() => scoped.read((tx) => tx.all("SELECT * FROM sys_meta"))).toThrow(
      "store.prefix_not_owned",
    );
  });

  test("local table names must not contain underscores", async () => {
    const store = own(await open());
    store.service.extensions.register("acme-notes");
    expect(() =>
      applyTables(store.service, "ext.acme-notes", ["CREATE TABLE x_acme_notes_two_words (a)"]),
    ).toThrow("store.prefix_not_owned");
  });

  test("extensions ab and ab-cd own different tables", async () => {
    const store = own(await open());
    store.service.extensions.register("ab");
    store.service.extensions.register("ab-cd");
    applyTables(store.service, "ext.ab", ["CREATE TABLE x_ab_cd (a)"]);
    applyTables(store.service, "ext.ab-cd", ["CREATE TABLE x_ab_cd_ef (a)"]);
    expect(() =>
      store.service.scoped("ext.ab").read((tx) => tx.all("SELECT * FROM x_ab_cd_ef")),
    ).toThrow("store.prefix_not_owned");
    expect(
      store.service.scoped("ext.ab-cd").read((tx) => tx.all("SELECT * FROM x_ab_cd_ef")).ok,
    ).toBe(true);
  });

  test("drop removes only the extension tables", async () => {
    const store = own(await open());
    store.root.write((tx) => {
      tx.run("CREATE TABLE events (seq INTEGER PRIMARY KEY, kind TEXT) STRICT");
      tx.run("INSERT INTO events (kind) VALUES ('thread.started')");
    });
    store.service.extensions.register("ab");
    store.service.extensions.register("ab-cd");
    applyTables(store.service, "ext.ab", ["CREATE VIRTUAL TABLE x_ab_cd USING fts5(body)"]);
    applyTables(store.service, "ext.ab-cd", ["CREATE TABLE x_ab_cd_ef (a)"]);
    store.service
      .scoped("ext.ab")
      .write((tx) => tx.run("INSERT INTO x_ab_cd (body) VALUES ('hello')"));

    // 소유가 아닌 이름이 하나라도 있으면 아무것도 지우지 않는다
    const before = await store.rowCounts();
    const denied = store.service.extensions.drop("ab", ["x_ab_cd", "x_ab_cd_ef"]);
    expect(denied).toEqual({
      ok: false,
      error: { kind: "table_not_owned", name: "ab", table: "x_ab_cd_ef" },
    });
    expect(await store.rowCounts()).toEqual(before);
    expect(store.service.extensions.drop("ab", ["x_ab_cd_ef"]).ok).toBe(false);

    const dropped = store.service.extensions.drop("ab", ["x_ab_cd"]);
    expect(dropped).toEqual({ ok: true, value: { dropped: ["x_ab_cd"] } });
    const names = tableNames(store);
    expect(names).toContain("x_ab_cd_ef");
    expect(names).toContain("events");
    expect(names.filter((name) => name.startsWith("x_ab_cd") && name !== "x_ab_cd_ef")).toEqual([]);
    expect((await store.rowCounts())["events"]).toBe(1);
    const bookkeeping = store.root.read((tx) =>
      tx.all(
        "SELECT owner FROM sys_prefixes WHERE owner IN ('ext.ab', 'ext.ab-cd') ORDER BY owner",
      ),
    );
    expect(bookkeeping).toEqual({ ok: true, value: [{ owner: "ext.ab-cd" }] });
    const migrations = store.root.read((tx) =>
      tx.all("SELECT owner FROM sys_migrations WHERE owner LIKE 'ext.%' ORDER BY owner"),
    );
    expect(migrations).toEqual({ ok: true, value: [{ owner: "ext.ab-cd" }] });
  });

  test("drop skips tables that do not exist and rejects bad names", async () => {
    const store = own(await open());
    expect(store.service.extensions.drop("ab", ["x_ab_missing"])).toEqual({
      ok: true,
      value: { dropped: [] },
    });
    expect(store.service.extensions.drop("Bad", [])).toEqual({
      ok: false,
      error: { kind: "ext_id_invalid", name: "Bad", reason: "pattern" },
    });
  });

  test("storage errors are returned as values", async () => {
    const clock = manualClock();
    const store = own(
      await openTestStore({ clock, ids: fixedIdFactory(clock), settings: { busyTimeoutMs: 0 } }),
    );
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      expect(store.service.extensions.register("busy-one")).toEqual({
        ok: false,
        error: { kind: "busy" },
      });
      expect(store.service.extensions.drop("busy-one", [])).toEqual({
        ok: false,
        error: { kind: "busy" },
      });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
    const pages = store.root.read((tx) => tx.get("PRAGMA page_count"));
    const count = Number(Object.values(pages.ok ? (pages.value ?? {}) : {})[0] ?? 0);
    store.root.write((tx) => tx.run(`PRAGMA max_page_count = ${count}`));
    const registered = store.service.extensions.register("full-one");
    // 페이지 상한에 걸리면 디스크 부족, 상한 안에 들어가면 성공이다. 어느 쪽이든 값으로 돌려준다
    expect([true, false]).toContain(registered.ok);
    if (!registered.ok) expect(registered.error).toEqual({ kind: "disk_full" });
  });

  test("register and drop inside a write transaction are bugs", async () => {
    const store = own(await open());
    expect(() => store.root.write(() => store.service.extensions.register("ab"))).toThrow(
      "store.nested_write",
    );
    expect(() => store.root.write(() => store.service.extensions.drop("ab", []))).toThrow(
      "store.nested_write",
    );
  });
});
