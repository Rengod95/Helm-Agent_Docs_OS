import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobRef } from "@xeon/contracts/records";
import { sha256Hex } from "../src/hash.ts";
import { openStore, type OpenResult } from "../src/index.ts";
import { TEST_HOLDER_A } from "../src/testing/index.ts";
import { directOptions } from "./support/store.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("a blob written before the read-only open");
const NEW_BYTES = new TextEncoder().encode("a blob the read-only store must refuse");
const REFUSED = { ok: false, error: { kind: "io", code: "SQLITE_READONLY" } } as const;

/** 쓰기 열기로 행과 블롭 하나를 넣고 닫는다 */
async function seed(path: string): Promise<BlobRef> {
  const opened = await openStore(directOptions(path).options);
  if (!opened.ok) throw new Error(`setup failed: ${opened.error.kind}`);
  const store = opened.value;
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    tx.run("INSERT INTO t_probe (body) VALUES ('kept')");
  });
  if (!made.ok) throw new Error(`setup failed: ${made.error.kind}`);
  const put = store.service.putBlob(BYTES, "text/plain");
  if (!put.ok) throw new Error(`putBlob failed: ${put.error.kind}`);
  await store.close();
  return put.value;
}

/** 코드보다 높은 sys 버전을 적어 다른 Xeon 버전이 만든 DB를 흉내 낸다 */
function markFuture(path: string): void {
  const newer = new Database(path);
  newer.run(
    `INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version)
     VALUES ('sys', 4, '${"1".repeat(64)}', 1, '9.9.9')`,
  );
  newer.close();
}

function digest(path: string): string {
  return sha256Hex(readFileSync(path));
}

function openReadOnly(path: string): Promise<OpenResult> {
  return openStore(directOptions(path, { readOnly: true }).options);
}

describe("read-only open", () => {
  test("a future-version database opens read-only and reports the version gap", async () => {
    const dir = own(tempDir());
    const path = join(dir.path, "xeon.db");
    await seed(path);
    markFuture(path);

    const opened = await openReadOnly(path);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    own(opened.value);
    expect(opened.value.warnings).toEqual([
      { kind: "read_only", reason: "future_version", owner: "sys", dbVersion: 4, codeVersion: 3 },
    ]);
  });

  test("reads return the rows and blobs that were written", async () => {
    const dir = own(tempDir());
    const path = join(dir.path, "xeon.db");
    const ref = await seed(path);
    markFuture(path);

    const opened = await openReadOnly(path);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    const store = own(opened.value);
    expect(store.root.read((tx) => tx.all("SELECT body FROM t_probe"))).toEqual({
      ok: true,
      value: [{ body: "kept" }],
    });
    expect(store.service.readBlob(ref)).toEqual({ ok: true, value: new Uint8Array(BYTES) });
  });

  test("every write path refuses with SQLITE_READONLY and the database file is unchanged", async () => {
    const dir = own(tempDir());
    const path = join(dir.path, "xeon.db");
    const ref = await seed(path);
    markFuture(path);
    const before = digest(path);

    const opened = await openReadOnly(path);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    const store = own(opened.value);
    const owner = "cap.knowledge";
    const blobDir = join(dir.path, "blobs");

    expect(store.root.write((tx) => tx.run("INSERT INTO t_probe (body) VALUES ('x')"))).toEqual(
      REFUSED,
    );
    expect(
      store.service
        .scoped(owner)
        .write((tx) => tx.run("INSERT INTO cap_knowledge_probe (body) VALUES ('x')")),
    ).toEqual(REFUSED);
    const newSha = sha256Hex(NEW_BYTES);
    expect(store.service.putBlob(NEW_BYTES, "text/plain")).toEqual(REFUSED);
    expect(existsSync(join(blobDir, newSha.slice(0, 2)))).toBe(false);
    expect(store.service.pinBlob(owner, ref.sha256, "turn-1")).toEqual(REFUSED);
    expect(store.service.unpinBlob(owner, "turn-1")).toEqual(REFUSED);
    expect(store.gcBlobs({ liveRefs: new Set() })).toEqual(REFUSED);
    expect(existsSync(join(blobDir, ref.sha256.slice(0, 2), ref.sha256.slice(2)))).toBe(true);
    expect(store.service.leases.acquire("scheduler", TEST_HOLDER_A)).toEqual({
      ok: false,
      error: { kind: "lock_io", code: "SQLITE_READONLY" },
    });
    expect(
      store.service.migrations.apply({
        owner,
        version: 1,
        steps: [{ version: 1, sql: ["CREATE TABLE cap_knowledge_probe (id INTEGER)"] }],
      }),
    ).toEqual({
      ok: false,
      error: { kind: "migration_failed", owner, version: 1, code: "SQLITE_READONLY" },
    });

    expect(digest(path)).toBe(before);
  });

  test("a current-version database opens read-only without warnings", async () => {
    const dir = own(tempDir());
    const path = join(dir.path, "xeon.db");
    await seed(path);

    const opened = await openReadOnly(path);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    const store = own(opened.value);
    expect(store.warnings).toEqual([]);
  });

  test("a read-only open does not create a missing file", async () => {
    const dir = own(tempDir());
    const path = join(dir.path, "missing.db");
    expect(await openReadOnly(path)).toEqual({
      ok: false,
      error: { kind: "io", code: "SQLITE_CANTOPEN" },
    });
    expect(existsSync(path)).toBe(false);
  });
});
