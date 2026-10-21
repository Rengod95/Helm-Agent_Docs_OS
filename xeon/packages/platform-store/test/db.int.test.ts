import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { classifySqliteCode } from "../src/db.ts";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

async function open(
  settings: { busyTimeoutMs?: number } = {},
): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  const store = await openTestStore({ clock, ids: fixedIdFactory(clock), settings });
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
  });
  if (!made.ok) throw new Error("setup failed");
  return store;
}

describe("StoreDb write and read", () => {
  test("write commits and read sees the committed rows", async () => {
    const store = own(await open());
    const written = store.root.write((tx) => {
      tx.run("INSERT INTO t_probe (body) VALUES (?)", ["a"]);
      return tx.run("INSERT INTO t_probe (body) VALUES (?)", ["b"]).changes;
    });
    expect(written).toEqual({ ok: true, value: 1 });
    const read = store.root.read((tx) => tx.all("SELECT body FROM t_probe ORDER BY id"));
    expect(read).toEqual({ ok: true, value: [{ body: "a" }, { body: "b" }] });
  });

  test("a throwing callback rolls back and rethrows", async () => {
    const store = own(await open());
    expect(() =>
      store.root.write((tx) => {
        tx.run("INSERT INTO t_probe (body) VALUES ('x')");
        throw new Bug("boom");
      }),
    ).toThrow("boom");
    expect((await store.rowCounts())["t_probe"]).toBe(0);
  });

  test("constraint errors inside the callback are rethrown after rollback", async () => {
    const store = own(await open());
    expect(() =>
      store.root.write((tx) => {
        tx.run("INSERT INTO t_probe (id, body) VALUES (1, 'x')");
        tx.run("INSERT INTO t_probe (id, body) VALUES (1, 'y')");
      }),
    ).toThrow();
    expect((await store.rowCounts())["t_probe"]).toBe(0);
  });

  test("nested write is a bug and rolls back", async () => {
    const store = own(await open());
    expect(() =>
      store.root.write((tx) => {
        tx.run("INSERT INTO t_probe (body) VALUES ('outer')");
        store.root.write((inner) => inner.run("INSERT INTO t_probe (body) VALUES ('inner')"));
      }),
    ).toThrow("store.nested_write");
    expect((await store.rowCounts())["t_probe"]).toBe(0);
    // 바깥 호출이 실패해도 표지가 풀려 다음 write가 동작한다
    expect(store.root.write(() => 1)).toEqual({ ok: true, value: 1 });
  });

  test("async callback is a bug", async () => {
    const store = own(await open());
    expect(() => store.root.write(async () => 1)).toThrow("store.async_tx");
    expect(() => store.root.read(async () => 1)).toThrow("store.async_tx");
  });

  test("busy beyond timeout is a Result error", async () => {
    const store = own(await open({ busyTimeoutMs: 0 }));
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      const result = store.root.write((tx) => tx.run("INSERT INTO t_probe (body) VALUES ('x')"));
      expect(result).toEqual({ ok: false, error: { kind: "busy" } });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
    expect(store.root.write(() => 1).ok).toBe(true);
  });

  test("write takes the write lock at BEGIN (BEGIN IMMEDIATE)", async () => {
    const store = own(await open({ busyTimeoutMs: 0 }));
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      // 콜백이 아무 문장도 실행하지 않아도 BEGIN 시점에 잠금을 잡으므로 busy다(DEFERRED면 성공한다)
      expect(store.root.write(() => 1)).toEqual({ ok: false, error: { kind: "busy" } });
      // 읽기는 쓰기 잠금과 상관없이 된다(WAL)
      expect(store.root.read(() => 1)).toEqual({ ok: true, value: 1 });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
  });

  test("disk full maps to disk_full", async () => {
    const store = own(await open());
    const sizeResult = store.root.read((tx) => tx.get("PRAGMA page_count"));
    const pages = Number(Object.values(sizeResult.ok ? (sizeResult.value ?? {}) : {})[0] ?? 0);
    store.root.write((tx) => tx.run(`PRAGMA max_page_count = ${pages + 4}`));
    const before = await store.rowCounts();
    const result = store.root.write((tx) => {
      for (let i = 0; i < 200; i += 1) {
        tx.run("INSERT INTO t_probe (body) VALUES (?)", ["x".repeat(4000)]);
      }
    });
    expect(result).toEqual({ ok: false, error: { kind: "disk_full" } });
    expect(await store.rowCounts()).toEqual(before);
  });

  test("operations after close are a bug", async () => {
    const store = own(await open());
    await store.opened.close();
    expect(() => store.root.write(() => 1)).toThrow("store.closed");
    expect(() => store.root.read(() => 1)).toThrow("store.closed");
    await store.opened.close();
  });

  test("read callbacks see one snapshot", async () => {
    const store = own(await open());
    store.root.write((tx) => tx.run("INSERT INTO t_probe (body) VALUES ('1')"));
    const counts = store.root.read((tx) => {
      const first = tx.get("SELECT count(*) AS n FROM t_probe");
      const writer = new Database(store.path);
      writer.run("INSERT INTO t_probe (body) VALUES ('2')");
      writer.close();
      const second = tx.get("SELECT count(*) AS n FROM t_probe");
      return [first?.["n"], second?.["n"]];
    });
    expect(counts).toEqual({ ok: true, value: [1, 1] });
  });

  test("blob and null cells are converted to SqlRow values", async () => {
    const store = own(await open());
    // bun:sqlite는 정수·실수·문자열·블롭·null만 돌려주므로 모두 SqlRow가 된다
    const row = store.root.read((tx) =>
      tx.get("SELECT 1 AS i, 1.5 AS r, 'x' AS s, x'00ff' AS b, NULL AS n"),
    );
    expect(row.ok && row.value?.["b"] instanceof Uint8Array).toBe(true);
    expect(row.ok && row.value?.["n"]).toBeNull();
  });
});

describe("classifySqliteCode", () => {
  test.each([
    ["SQLITE_BUSY", "busy"],
    ["SQLITE_BUSY_SNAPSHOT", "busy"],
    ["SQLITE_LOCKED", "busy"],
    ["SQLITE_FULL", "disk_full"],
    ["SQLITE_IOERR_WRITE", "io"],
    ["SQLITE_READONLY_DBMOVED", "io"],
    ["SQLITE_CANTOPEN", "io"],
    ["SQLITE_CORRUPT", "corrupt"],
    ["SQLITE_NOTADB", "corrupt"],
    ["SQLITE_CONSTRAINT_UNIQUE", "other"],
    [undefined, "other"],
  ] as const)("%s is %s", (code, expected) => {
    expect(classifySqliteCode(code)).toBe(expected);
  });
});
