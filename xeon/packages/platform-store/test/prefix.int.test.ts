import { afterEach, describe, expect, test } from "bun:test";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { applyTables } from "./support/migrate.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

async function open(strictPrefix = true): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  const store = await openTestStore({ clock, ids: fixedIdFactory(clock), strictPrefix });
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE p_turns (id INTEGER PRIMARY KEY, body TEXT) STRICT");
  });
  if (!made.ok) throw new Error("setup failed");
  applyTables(store.service, "cap.knowledge", [
    "CREATE TABLE cap_knowledge_x (id INTEGER PRIMARY KEY, body TEXT) STRICT",
  ]);
  return store;
}

describe("scoped handles", () => {
  test("statements outside the owner prefix are rejected in strict builds", async () => {
    const store = own(await open());
    const scoped = store.service.scoped("cap.knowledge");
    expect(() => scoped.read((tx) => tx.all("SELECT * FROM p_turns"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(() => scoped.write((tx) => tx.run("INSERT INTO p_turns (body) VALUES ('x')"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(() => scoped.write((tx) => tx.run("UPDATE sys_leases SET epoch = epoch + 1"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(() =>
      scoped.write((tx) => tx.run("INSERT INTO cap_knowledge_x (body) SELECT body FROM p_turns")),
    ).toThrow("store.prefix_not_owned");
    // 소유 테이블은 통과한다
    const written = scoped.write(
      (tx) => tx.run("INSERT INTO cap_knowledge_x (body) VALUES (?)", ["ok"]).changes,
    );
    expect(written).toEqual({ ok: true, value: 1 });
    expect(scoped.read((tx) => tx.all("SELECT body FROM cap_knowledge_x"))).toEqual({
      ok: true,
      value: [{ body: "ok" }],
    });
  });

  test("truncating deletes and other root page operations are checked", async () => {
    const store = own(await open());
    const scoped = store.service.scoped("cap.knowledge");
    // WHERE 없는 DELETE는 Clear 연산(truncate 최적화)으로 실행되어 OpenWrite가 없다
    expect(() => scoped.write((tx) => tx.run("DELETE FROM p_turns"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(() => scoped.write((tx) => tx.run("DELETE FROM p_turns WHERE id = 1"))).toThrow(
      "store.prefix_not_owned",
    );
    expect(scoped.write((tx) => tx.run("DELETE FROM cap_knowledge_x")).ok).toBe(true);
    expect(() =>
      scoped.write((tx) =>
        tx.run("WITH t AS (SELECT 1) DELETE FROM p_turns WHERE id IN (SELECT * FROM t)"),
      ),
    ).toThrow("store.prefix_not_owned");
  });

  test.each([true, false])(
    "transaction control, maintenance and multiple statements are forbidden (strict builds = %p)",
    async (strict) => {
      const store = own(await open(strict));
      const scoped = store.service.scoped("cap.knowledge");
      for (const sql of ["COMMIT", "ROLLBACK", "SAVEPOINT a", "VACUUM", "ANALYZE", "REINDEX"]) {
        expect(() => scoped.write((tx) => tx.run(sql))).toThrow("store.statement_forbidden");
      }
      expect(() =>
        scoped.write((tx) =>
          tx.run("INSERT INTO cap_knowledge_x (body) VALUES ('a'); DELETE FROM p_turns"),
        ),
      ).toThrow("store.statement_forbidden");
      expect((await store.rowCounts())["cap_knowledge_x"]).toBe(0);
    },
  );

  test("extensions may not create triggers or views", async () => {
    const store = own(await open());
    store.service.extensions.register("probe");
    expect(() =>
      applyTables(store.service, "ext.probe", [
        "CREATE TABLE x_probe_a (a)",
        "CREATE VIEW x_probe_v AS SELECT * FROM p_turns",
      ]),
    ).toThrow("store.statement_forbidden");
    expect(() =>
      applyTables(store.service, "ext.probe", [
        "CREATE TRIGGER x_probe_t AFTER INSERT ON x_probe_a BEGIN DELETE FROM p_turns; END",
      ]),
    ).toThrow("store.statement_forbidden");
  });

  test("production builds only inspect ddl statements", async () => {
    const store = own(await open(false));
    const scoped = store.service.scoped("cap.knowledge");
    expect(scoped.read((tx) => tx.all("SELECT * FROM p_turns")).ok).toBe(true);
    expect(() => scoped.write((tx) => tx.run("CREATE TABLE cap_knowledge_y (a)"))).toThrow(
      "store.ddl_outside_migration",
    );
  });

  test.each([true, false])(
    "ddl outside migrations is rejected (strict builds = %p)",
    async (strict) => {
      const store = own(await open(strict));
      const scoped = store.service.scoped("cap.knowledge");
      expect(() => scoped.write((tx) => tx.run("CREATE TABLE cap_knowledge_y (a)"))).toThrow(
        "store.ddl_outside_migration",
      );
      expect(() => scoped.write((tx) => tx.run("DROP TABLE cap_knowledge_x"))).toThrow(
        "store.ddl_outside_migration",
      );
      expect(() => scoped.write((tx) => tx.run("ATTACH DATABASE ':memory:' AS other"))).toThrow(
        "store.statement_forbidden",
      );
      expect(() => scoped.write((tx) => tx.run("PRAGMA journal_mode = DELETE"))).toThrow(
        "store.statement_forbidden",
      );
      expect(scoped.read((tx) => tx.get("PRAGMA table_info(cap_knowledge_x)")).ok).toBe(true);
      expect(() => scoped.read((tx) => tx.get("PRAGMA table_info(p_turns)"))).toThrow(
        "store.prefix_not_owned",
      );
    },
  );

  test("migrations may only create tables the owner owns", async () => {
    const store = own(await open());
    expect(() => applyTables(store.service, "cap.web", ["CREATE TABLE p_stolen (a)"])).toThrow(
      "store.prefix_not_owned",
    );
    expect(() =>
      applyTables(store.service, "cap.work", ["CREATE INDEX cap_work_i ON p_turns (body)"]),
    ).toThrow("store.prefix_not_owned");
    expect((await store.rowCounts())["p_stolen"]).toBeUndefined();
  });

  test("root only and unknown owners have no scoped handle", async () => {
    const store = own(await open());
    expect(() => store.service.scoped("core.persistence")).toThrow("store.prefix_not_owned");
    expect(() => store.service.scoped("sys")).toThrow("store.prefix_not_owned");
    expect(() => store.service.scoped("ext.unregistered")).toThrow("store.prefix_not_owned");
    expect(() => store.service.scoped("cap.nothing")).toThrow("store.prefix_not_owned");
    expect(store.service.scoped("xh")).toBeDefined();
  });

  test("explain cache is refreshed on schema change", async () => {
    const store = own(await open());
    const scoped = store.service.scoped("cap.knowledge");
    expect(scoped.read((tx) => tx.all("SELECT * FROM cap_knowledge_x")).ok).toBe(true);
    // 소유 테이블을 지우고 그 루트 페이지에 다른 소유자의 테이블을 만든 뒤 같은 이름을 다시 만든다
    const reshaped = store.root.write((tx) => {
      tx.run("DROP TABLE cap_knowledge_x");
      tx.run("CREATE TABLE p_reused (id INTEGER PRIMARY KEY, body TEXT) STRICT");
      tx.run("CREATE TABLE cap_knowledge_x (id INTEGER PRIMARY KEY, body TEXT) STRICT");
    });
    expect(reshaped.ok).toBe(true);
    expect(scoped.read((tx) => tx.all("SELECT * FROM cap_knowledge_x")).ok).toBe(true);
    expect(() => scoped.read((tx) => tx.all("SELECT * FROM p_reused"))).toThrow(
      "store.prefix_not_owned",
    );
  });

  test("statements are verified once and then cached", async () => {
    const store = own(await open());
    const scoped = store.service.scoped("cap.knowledge");
    for (let i = 0; i < 3; i += 1) {
      expect(
        scoped.write((tx) => tx.run("INSERT INTO cap_knowledge_x (body) VALUES ('x')")).ok,
      ).toBe(true);
    }
    expect((await store.rowCounts())["cap_knowledge_x"]).toBe(3);
  });
});
