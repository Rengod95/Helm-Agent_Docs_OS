import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobRef } from "@fresnel/contracts/records";
import { exportDatabase, openStore, restoreDatabase, type RestorePoint } from "../src/index.ts";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("backup blob bytes");

function rowsOf(path: string): unknown {
  const db = new Database(path, { readonly: true });
  try {
    return db.query("SELECT body FROM t_probe ORDER BY id").all();
  } finally {
    db.close();
  }
}

async function seed(
  path: string,
  clock: ManualClock,
  body: string,
  blob: Uint8Array | null,
): Promise<BlobRef | null> {
  const store = await openTestStore({ path, clock, ids: fixedIdFactory(clock) });
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    tx.run("INSERT INTO t_probe (body) VALUES (?)", [body]);
  });
  if (!made.ok) throw new Error(`setup failed: ${made.error.kind}`);
  let ref: BlobRef | null = null;
  if (blob !== null) {
    const put = store.service.putBlob(blob, "text/plain");
    if (!put.ok) throw new Error(`putBlob failed: ${put.error.kind}`);
    ref = put.value;
  }
  await store.opened.close();
  return ref;
}

/** 백업(내용 "from-backup", 블롭 하나)과 현재 데이터 디렉터리(내용 "current")를 만든다 */
async function fixture(): Promise<{
  readonly dbPath: string;
  readonly backup: string;
  readonly clock: ManualClock;
  readonly ref: BlobRef;
  readonly root: string;
}> {
  const dir = own(tempDir());
  const clock = manualClock();
  const srcDb = join(dir.path, "src", "fresnel.db");
  const ref = await seed(srcDb, clock, "from-backup", BYTES);
  if (ref === null) throw new Error("no blob ref");
  const backup = join(dir.path, "backup");
  const exported = exportDatabase({ dbPath: srcDb, destDir: backup, clock });
  if (!exported.ok) throw new Error(`export failed: ${exported.error.kind}`);
  const dbPath = join(dir.path, "data", "fresnel.db");
  await seed(dbPath, clock, "current", null);
  return { dbPath, backup, clock, ref, root: dir.path };
}

function sides(dbPath: string): readonly boolean[] {
  return ["-wal", "-shm"].map((suffix) => existsSync(`${dbPath}${suffix}`));
}

function crashAt(point: RestorePoint): (p: RestorePoint) => void {
  return (p) => {
    if (p === point) throw new Error("simulated crash");
  };
}

describe("restoreDatabase", () => {
  test("round trip: rows and blob bytes come back, the old database is kept, no -wal/-shm remain", async () => {
    const f = await fixture();
    const restored = restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock });
    if (!restored.ok) throw new Error(`restore failed: ${restored.error.kind}`);
    expect(restored.value.blobsAdded).toBe(1);
    expect(restored.value.missingBlobs).toEqual([]);
    expect(restored.value.recovered).toBeNull();
    expect(rowsOf(f.dbPath)).toEqual([{ body: "from-backup" }]);
    expect(sides(f.dbPath)).toEqual([false, false]);
    const previous = restored.value.previousDir;
    if (previous === null) throw new Error("previousDir is null");
    expect(rowsOf(join(previous, "fresnel.db"))).toEqual([{ body: "current" }]);
    // 복원한 DB를 저장소로 열어 블롭 바이트가 같은지 본다
    const store = await openTestStore({
      path: f.dbPath,
      clock: f.clock,
      ids: fixedIdFactory(f.clock),
    });
    own(store.opened);
    expect(store.service.readBlob(f.ref)).toEqual({ ok: true, value: new Uint8Array(BYTES) });
  });

  test("refuses while another connection holds the database and changes nothing", async () => {
    const f = await fixture();
    const live = await openStore(
      (await import("./support/store.ts")).directOptions(f.dbPath).options,
    );
    if (!live.ok) throw new Error(`open failed: ${live.error.kind}`);
    own(live.value);
    const restored = restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock });
    expect(restored).toEqual({ ok: false, error: { kind: "engine_running" } });
    expect(existsSync(join(f.root, "data", "restore-previous"))).toBe(false);
    await live.value.close();
    expect(rowsOf(f.dbPath)).toEqual([{ body: "current" }]);
  });

  test("refuses a backup made by a newer version and keeps the current database", async () => {
    const f = await fixture();
    const db = new Database(join(f.backup, "fresnel.sqlite"));
    db.run(
      `INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version)
       VALUES ('sys', 4, '${"1".repeat(64)}', 1, '9.9.9')`,
    );
    db.close();
    const restored = restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock });
    expect(restored).toEqual({
      ok: false,
      error: { kind: "future_version", backupVersion: 4, codeVersion: 3 },
    });
    expect(rowsOf(f.dbPath)).toEqual([{ body: "current" }]);
    expect(existsSync(join(f.root, "data", "restore-previous"))).toBe(false);
  });

  test("refuses a damaged blob, a missing blob and a missing manifest before touching anything", async () => {
    const f = await fixture();
    const blob = join(f.backup, "blobs", f.ref.sha256.slice(0, 2), f.ref.sha256.slice(2));
    writeFileSync(blob, "tampered");
    expect(restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock })).toEqual({
      ok: false,
      error: { kind: "backup_invalid", reason: "blob_hash" },
    });
    writeFileSync(join(f.backup, "manifest.json"), "{not json");
    expect(restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock })).toEqual({
      ok: false,
      error: { kind: "backup_invalid", reason: "manifest" },
    });
    expect(
      restoreDatabase({ dbPath: f.dbPath, backupDir: join(f.root, "nope"), clock: f.clock }),
    ).toEqual({ ok: false, error: { kind: "backup_not_found" } });
    expect(rowsOf(f.dbPath)).toEqual([{ body: "current" }]);
  });

  test("restores into an empty data directory without a previous copy", async () => {
    const f = await fixture();
    const target = join(f.root, "fresh", "fresnel.db");
    const restored = restoreDatabase({ dbPath: target, backupDir: f.backup, clock: f.clock });
    if (!restored.ok) throw new Error(`restore failed: ${restored.error.kind}`);
    expect(restored.value.previousDir).toBeNull();
    expect(rowsOf(target)).toEqual([{ body: "from-backup" }]);
  });

  const POINTS: readonly RestorePoint[] = [
    "after_blobs",
    "after_staged",
    "after_journal_moving",
    "after_move_db",
    "after_move_wal",
    "after_move_shm",
    "after_journal_moved",
    "after_swap",
  ];
  for (const point of POINTS) {
    test(`a crash at ${point} loses nothing and a second restore finishes`, async () => {
      const f = await fixture();
      const crash = crashAt(point);
      expect(() =>
        restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock, hit: crash }),
      ).toThrow("simulated crash");
      // 현재 DB는 제자리에 있거나 restore-previous에 있다. 어느 쪽이든 어딘가에 남아 있다
      const prevRoot = join(f.root, "data", "restore-previous");
      const kept =
        (existsSync(f.dbPath) && JSON.stringify(rowsOf(f.dbPath)).includes("current")) ||
        (existsSync(prevRoot) &&
          readdirSync(prevRoot).some((name) => existsSync(join(prevRoot, name, "fresnel.db")))) ||
        (existsSync(f.dbPath) && JSON.stringify(rowsOf(f.dbPath)).includes("from-backup"));
      expect(kept).toBe(true);
      const again = restoreDatabase({ dbPath: f.dbPath, backupDir: f.backup, clock: f.clock });
      if (!again.ok) throw new Error(`second restore failed: ${again.error.kind}`);
      expect(rowsOf(f.dbPath)).toEqual([{ body: "from-backup" }]);
      expect(sides(f.dbPath)).toEqual([false, false]);
      expect(readFileSync(join(f.root, "backup", "manifest.json"), "utf8")).toContain('"format"');
      expect(existsSync(`${f.dbPath}.restore-journal`)).toBe(false);
      expect(existsSync(`${f.dbPath}.restore-staging`)).toBe(false);
    });
  }
});
