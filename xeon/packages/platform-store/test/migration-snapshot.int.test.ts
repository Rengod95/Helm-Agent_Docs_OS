import { mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { attempt } from "@xeon/contracts";
import type { MigrationSet } from "@xeon/contracts/records";
import { openTestStore } from "../src/testing/index.ts";
import { newDatabase } from "../src/sqlite-env.ts";
import { MIGRATION_SNAPSHOT_KEEP, snapshotBeforeMigration } from "../src/snapshot.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

// L0.store.spec §4.6.1: 기존 스키마를 올리기 전에 VACUUM INTO 스냅샷을 만들고 최근 3개만 남긴다.

afterEach(releaseOwned);

const STEPS = [
  "CREATE TABLE cap_knowledge_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT",
  "ALTER TABLE cap_knowledge_notes ADD COLUMN tag TEXT",
  "ALTER TABLE cap_knowledge_notes ADD COLUMN pinned INTEGER",
  "ALTER TABLE cap_knowledge_notes ADD COLUMN archived INTEGER",
  "ALTER TABLE cap_knowledge_notes ADD COLUMN score INTEGER",
];

function set(count: number): MigrationSet {
  return {
    owner: "cap.knowledge",
    version: count,
    steps: STEPS.slice(0, count).map((sql, index) => ({ version: index + 1, sql: [sql] })),
  };
}

async function open() {
  const clock = manualClock();
  const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
  return {
    store,
    clock, // 저장소는 DB 디렉터리의 realpath 아래에 스냅샷을 만든다(L0.store.spec §4.6.1). macOS는 /var가 /private/var 링크다
    backups: join(realpathSync(dirname(store.path)), "backups"),
  };
}

function snapshots(backups: string): string[] {
  // 디렉터리가 아직 없으면 스냅샷이 없다
  const listed = attempt(() => readdirSync(backups).toSorted());
  return listed.ok ? listed.value : [];
}

/** 스냅샷 파일을 읽기 전용으로 열어 질의 결과를 돌려준다 */
function readSnapshot(path: string, sql: string): unknown[] {
  const db = newDatabase(path, { readonly: true });
  try {
    return db.query<unknown, []>(sql).all();
  } finally {
    db.close();
  }
}

describe("pre-migration snapshot", () => {
  test("the first apply of an owner and an up-to-date apply make no snapshot", async () => {
    const { store, backups } = await open();
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    expect(snapshots(backups)).toEqual([]);
    expect(store.opened.warnings.filter((w) => w.kind === "migration_snapshot")).toEqual([]);
  });

  test("upgrading an existing schema copies the whole DB as it was before the first new step", async () => {
    const { store, backups } = await open();
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    const wrote = store.root.write((tx) => {
      tx.run("INSERT INTO cap_knowledge_notes (id, body) VALUES (1, 'keep me')");
    });
    expect(wrote.ok).toBe(true);

    expect(store.service.migrations.apply(set(2))).toEqual({
      ok: true,
      value: { owner: "cap.knowledge", from: 1, to: 2 },
    });

    const files = snapshots(backups);
    expect(files).toHaveLength(1);
    const name = files[0] ?? "";
    expect(name).toMatch(
      new RegExp(
        `^${basename(store.path)}\\.pre-\\d{8}T\\d{9}Z-cap\\.knowledge-v1-to-v2\\.sqlite$`,
      ),
    );
    const path = join(backups, name);
    // 스냅샷은 올리기 전 상태다: 행은 그대로, 새 단계의 컬럼은 없고, 적용 기록은 v1까지다
    expect(readSnapshot(path, "SELECT id, body FROM cap_knowledge_notes")).toEqual([
      { id: 1, body: "keep me" },
    ]);
    expect(
      readSnapshot(path, "SELECT name FROM pragma_table_info('cap_knowledge_notes') ORDER BY cid"),
    ).toEqual([{ name: "id" }, { name: "body" }]);
    expect(
      readSnapshot(
        path,
        "SELECT version FROM sys_migrations WHERE owner = 'cap.knowledge' ORDER BY version",
      ),
    ).toEqual([{ version: 1 }]);
    // 살아 있는 DB는 올라갔다
    const live = store.root.read((tx) =>
      tx.all("SELECT name FROM pragma_table_info('cap_knowledge_notes') ORDER BY cid"),
    );
    expect(live).toEqual({ ok: true, value: [{ name: "id" }, { name: "body" }, { name: "tag" }] });
    // 소유자만 읽는다
    expect(statSync(backups).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.opened.warnings).toContainEqual({
      kind: "migration_snapshot",
      path,
      owner: "cap.knowledge",
      from: 1,
      to: 2,
    });
  });

  test(`only the newest ${String(MIGRATION_SNAPSHOT_KEEP)} snapshots are kept`, async () => {
    const { store, clock, backups } = await open();
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    // 버전을 하나씩 올린다: 스냅샷 v1→2, v2→3, v3→4, v4→5. 시각이 달라야 이름이 달라진다
    const upgrade = async (target: number): Promise<void> => {
      await clock.advance(1000);
      expect(store.service.migrations.apply(set(target)).ok).toBe(true);
    };
    await upgrade(2);
    await upgrade(3);
    await upgrade(4);
    await upgrade(5);
    const files = snapshots(backups);
    expect(files).toHaveLength(MIGRATION_SNAPSHOT_KEEP);
    expect(files.map((file) => /-v(\d)-to-v(\d)\.sqlite$/.exec(file)?.slice(1, 3))).toEqual([
      ["2", "3"],
      ["3", "4"],
      ["4", "5"],
    ]);
  });

  test("a snapshot that cannot be made stops the migration before any step runs", async () => {
    const { store, backups } = await open();
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    // 스냅샷 디렉터리 자리에 일반 파일을 둔다
    mkdirSync(dirname(backups), { recursive: true });
    writeFileSync(backups, "not a directory");
    const result = store.service.migrations.apply(set(2));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "migration_failed",
        owner: "cap.knowledge",
        version: 2,
        code: "snapshot_failed:EEXIST",
      },
    });
    const columns = store.root.read((tx) =>
      tx.all("SELECT name FROM pragma_table_info('cap_knowledge_notes') ORDER BY cid"),
    );
    expect(columns).toEqual({ ok: true, value: [{ name: "id" }, { name: "body" }] });
    const applied = store.root.read((tx) =>
      tx.all("SELECT version FROM sys_migrations WHERE owner = 'cap.knowledge'"),
    );
    expect(applied).toEqual({ ok: true, value: [{ version: 1 }] });
  });
});

describe("concurrent snapshot of the same transition", () => {
  test("a snapshot that a peer already made for the same transition counts as made", async () => {
    const { store, backups } = await open();
    expect(store.service.migrations.apply(set(1)).ok).toBe(true);
    const input = { owner: "cap.knowledge", from: 1, to: 2, at: 1_700_000_000_000 };
    const config = {
      dir: backups,
      dbFileName: "xeon.db",
      keep: MIGRATION_SNAPSHOT_KEEP,
      posix: true,
    };
    const db = newDatabase(store.path);
    try {
      const first = snapshotBeforeMigration(db, config, input);
      const second = snapshotBeforeMigration(db, config, input);
      expect(first.ok && second.ok).toBe(true);
      expect(second).toEqual({
        ok: true,
        value: { path: first.ok ? first.value.path : "", pruned: [], pruneFailed: [] },
      });
      expect(snapshots(backups)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
