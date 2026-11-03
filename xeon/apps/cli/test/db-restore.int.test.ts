import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createIdFactory, systemRandom } from "@fresnel/platform-os";
import { exportDatabase, restoreDatabase, type RestorePoint } from "@fresnel/platform-store";
import { openTestStore } from "@fresnel/platform-store/testing";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness } from "./support/harness.ts";

// `db export`로 낸 사본을 `db restore`로 되돌리는 종단 시험. 실제 저장소 파일을 쓰고, 복원 중 죽은 뒤 다시 실행한다.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BLOB = new TextEncoder().encode("블롭: db restore round trip");

function bodies(path: string): unknown {
  const db = new Database(path, { readonly: true });
  try {
    return db.query("SELECT body FROM t_probe ORDER BY id").all();
  } finally {
    db.close();
  }
}

async function seed(
  path: string,
  body: string,
  blob: boolean,
  clock: { now(): number },
): Promise<void> {
  const store = await openTestStore({
    path,
    clock,
    ids: createIdFactory(clock, systemRandom()),
  });
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    tx.run("INSERT INTO t_probe (body) VALUES (?)", [body]);
  });
  if (!made.ok) throw new Error(`setup failed: ${made.error.kind}`);
  if (blob) store.service.putBlob(BLOB, "text/plain");
  await store.opened.close();
}

test("export, damage, restore: the rows come back, secrets are called out, and a crashed restore is finished by running it again", async () => {
  const root = mkdtempSync(join(tmpdir(), "xcli-restore-"));
  dirs.push(root);
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "fresnel.db");
  const backup = join(root, "backup");

  let crashAt: RestorePoint | null = null;
  const h = createHarness({
    dataDir,
    exportDatabase: (options) => Promise.resolve(exportDatabase(options)),
    restoreDatabase: (options) =>
      Promise.resolve(
        restoreDatabase({
          ...options,
          hit: (point) => {
            if (point === crashAt) throw new Error("simulated crash");
          },
        }),
      ),
  });
  try {
    await seed(dbPath, "good", true, h.clock);
    expect(await h.run(["db", "export", backup, "--yes"])).toBe(EXIT.ok);

    // 원본이 망가진 상황: 다른 내용으로 바꾼다
    const db = new Database(dbPath);
    db.run("UPDATE t_probe SET body = 'damaged'");
    db.close();
    expect(bodies(dbPath)).toEqual([{ body: "damaged" }]);

    // 복원 중 죽는다. 현재 DB는 어딘가에 남는다
    crashAt = "after_move_db";
    let thrown: unknown = null;
    try {
      await h.run(["db", "restore", backup]);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(existsSync(dbPath)).toBe(false);

    // 같은 명령을 다시 실행하면 끝난다
    crashAt = null;
    expect(await h.run(["db", "restore", backup])).toBe(EXIT.ok);
    expect(bodies(dbPath)).toEqual([{ body: "good" }]);
    expect(h.stderrText()).toContain("secrets/age/keys.txt");
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(existsSync(join(root, "data", "secrets"))).toBe(false);
  } finally {
    h.dispose();
  }
});
