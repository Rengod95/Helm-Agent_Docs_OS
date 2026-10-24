import { Database } from "bun:sqlite";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/hash.ts";
import { enableWal } from "../src/pragmas.ts";
import { openStore } from "../src/index.ts";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { directOptions } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

function pragma(
  store: Awaited<ReturnType<typeof openTestStore>>,
  name: string,
  connection: "write" | "read",
): unknown {
  const query = (tx: { get(sql: string): Record<string, unknown> | undefined }): unknown =>
    Object.values(tx.get(`PRAGMA ${name}`) ?? {})[0];
  if (connection === "write") {
    const result = store.root.write((tx) => query(tx));
    return result.ok ? result.value : undefined;
  }
  const result = store.root.read((tx) => query(tx));
  return result.ok ? result.value : undefined;
}

describe("connection pragmas", () => {
  test("pragmas are applied on the write connection", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    expect(pragma(store, "journal_mode", "write")).toBe("wal");
    expect(pragma(store, "synchronous", "write")).toBe(2);
    expect(pragma(store, "busy_timeout", "write")).toBe(5000);
    expect(pragma(store, "foreign_keys", "write")).toBe(1);
    expect(pragma(store, "trusted_schema", "write")).toBe(0);
    expect(pragma(store, "temp_store", "write")).toBe(2);
    expect(pragma(store, "application_id", "write")).toBe(1480937294);
    expect(pragma(store, "user_version", "write")).toBe(3);
  });

  test("read connection is query_only", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    expect(pragma(store, "query_only", "read")).toBe(1);
    const attempt = store.root.read((tx) =>
      tx.run("INSERT INTO sys_meta (key, value) VALUES ('x', 'y')"),
    );
    expect(attempt).toEqual({ ok: false, error: { kind: "io", code: "SQLITE_READONLY" } });
  });

  test("new database and its sidecar files are private", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    for (const suffix of ["-wal", "-shm"]) {
      expect(statSync(`${store.path}${suffix}`).mode & 0o077).toBe(0);
    }
  });

  test("open checks file existence without fileMustExist", () => {
    // src 전체에 옵션 이름이 없어야 한다(spec §9 2번)
    const sources = readdirSync(join(import.meta.dir, "..", "src"), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"));
    for (const name of sources) {
      expect(readFileSync(join(import.meta.dir, "..", "src", name), "utf8")).not.toContain(
        "fileMustExist",
      );
    }
  });

  test("a missing file is created with mode 0600 and the store opens", async () => {
    const dir = own(tempDir());
    const path = dir.join("nested", "xeon.db");
    const { options } = directOptions(path);
    const opened = await openStore(options);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir.join("nested")).mode & 0o777).toBe(0o700);
    await opened.value.close();
  });

  test("foreign application_id is rejected and the file is untouched", async () => {
    const dir = own(tempDir());
    const path = dir.join("foreign.db");
    const foreign = new Database(path, { create: true });
    foreign.run("PRAGMA application_id = 42");
    foreign.run("CREATE TABLE other (a)");
    foreign.close();
    const before = sha256Hex(readFileSync(path));
    const { options } = directOptions(path);
    const opened = await openStore(options);
    expect(opened).toEqual({ ok: false, error: { kind: "foreign_database", applicationId: 42 } });
    expect(sha256Hex(readFileSync(path))).toBe(before);
  });

  test("a database with tables but application_id 0 is foreign", async () => {
    const dir = own(tempDir());
    const path = dir.join("legacy.db");
    const legacy = new Database(path, { create: true });
    legacy.run("CREATE TABLE other (a)");
    legacy.close();
    const { options } = directOptions(path);
    const opened = await openStore(options);
    expect(opened).toEqual({ ok: false, error: { kind: "foreign_database", applicationId: 0 } });
  });

  test("a file that is not a database is reported as corrupt", async () => {
    const dir = own(tempDir());
    const path = dir.join("garbage.db");
    writeFileSync(path, "this is definitely not an sqlite database file".repeat(50));
    const { options } = directOptions(path);
    const opened = await openStore(options);
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.kind).toBe("corrupt");
  });

  test("relative and directory paths are rejected", async () => {
    const dir = own(tempDir());
    const relative = await openStore(directOptions("relative.db").options);
    expect(relative).toEqual({
      ok: false,
      error: { kind: "db_path_invalid", reason: "not_absolute" },
    });
    const directory = await openStore(directOptions(dir.path).options);
    expect(directory).toEqual({
      ok: false,
      error: { kind: "db_path_invalid", reason: "is_directory" },
    });
  });

  test.each(["network", "drvfs"] as const)("%s filesystems are rejected", async (fsKind) => {
    const dir = own(tempDir());
    const { options } = directOptions(dir.join(`${fsKind}.db`), {
      env: { ...directOptions("/x").options.env, dbDirFsKind: fsKind },
    });
    const opened = await openStore(options);
    expect(opened).toEqual({
      ok: false,
      error: { kind: "unsupported_filesystem", fsKind, dir: dir.path },
    });
  });

  test("an unknown filesystem only warns", async () => {
    const dir = own(tempDir());
    const unknown = directOptions(dir.join("unknown.db"), {
      env: { ...directOptions("/x").options.env, dbDirFsKind: "unknown" },
    });
    const opened = await openStore(unknown.options);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.warnings).toContainEqual({ kind: "fs_unknown", dir: dir.path });
    await opened.value.close();
  });

  test("a group-readable data directory is fixed with a warning", async () => {
    const dir = own(tempDir());
    const nested = dir.join("open");
    const { options } = directOptions(join(nested, "xeon.db"));
    const first = await openStore(options);
    if (!first.ok) throw new Error("setup failed");
    await first.value.close();
    chmodSync(nested, 0o755);
    const second = await openStore(options);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(statSync(nested).mode & 0o777).toBe(0o700);
    expect(second.value.warnings).toContainEqual({
      kind: "permission_fixed",
      path: nested,
      from: 0o755,
      to: 0o700,
    });
    await second.value.close();
  });
});

function legacyDatabase(path: string): void {
  const db = new Database(path, { create: true });
  db.run("CREATE TABLE t (a)");
  db.run("INSERT INTO t (a) VALUES (1)");
  db.close();
}

describe("switching to wal", () => {
  test("retries while another connection holds a shared lock", () => {
    const dir = own(tempDir());
    const path = dir.join("legacy.db");
    legacyDatabase(path);
    const writer = new Database(path);
    writer.run("PRAGMA busy_timeout = 0");
    const reader = new Database(path);
    reader.run("BEGIN");
    reader.query("SELECT * FROM t").all();
    const sleeps: number[] = [];
    enableWal(writer, 5, (ms) => {
      sleeps.push(ms);
      reader.run("ROLLBACK");
    });
    expect(sleeps).toEqual([20]);
    expect(writer.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    reader.close();
    writer.close();
  });

  test("gives up after the attempts are used", () => {
    const dir = own(tempDir());
    const path = dir.join("legacy.db");
    legacyDatabase(path);
    const writer = new Database(path);
    writer.run("PRAGMA busy_timeout = 0");
    const reader = new Database(path);
    reader.run("BEGIN");
    reader.query("SELECT * FROM t").all();
    expect(() => enableWal(writer, 2)).toThrow("database is locked");
    reader.run("ROLLBACK");
    reader.close();
    writer.close();
  });

  test("a plain wal switch needs no retry", () => {
    const dir = own(tempDir());
    const path = dir.join("legacy.db");
    legacyDatabase(path);
    const db = new Database(path);
    enableWal(db, 1, () => {
      throw new Error("must not sleep");
    });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();
  });
});
