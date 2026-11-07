import { Database } from "bun:sqlite";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobRef } from "@fresnel/contracts/records";
import { exportDatabase, openStore } from "../src/index.ts";
import { openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { directOptions } from "./support/store.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("exported blob bytes");
const OTHER = new TextEncoder().encode("a second blob that will go missing");

function probeRows(store: TestStore): unknown {
  const read = store.root.read((tx) => tx.all("SELECT id, body FROM t_probe ORDER BY id"));
  if (!read.ok) throw new Error(`read failed: ${read.error.kind}`);
  return read.value;
}

function blobRows(store: TestStore): unknown {
  const read = store.root.read((tx) =>
    tx.all("SELECT sha256, size, media_type FROM sys_blobs ORDER BY sha256"),
  );
  if (!read.ok) throw new Error(`read failed: ${read.error.kind}`);
  return read.value;
}

/** 쓰기 열기로 DB를 만들고 행과 블롭을 넣은 뒤 닫는다. 블롭 참조를 돌려준다 */
async function seedStore(
  path: string,
  clock: ManualClock,
  blobs: readonly Uint8Array[],
): Promise<readonly BlobRef[]> {
  const store = await openTestStore({ path, clock, ids: fixedIdFactory(clock) });
  const made = store.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    tx.run("INSERT INTO t_probe (body) VALUES ('a'), ('b')");
  });
  if (!made.ok) throw new Error(`setup failed: ${made.error.kind}`);
  const refs = blobs.map((bytes) => {
    const put = store.service.putBlob(bytes, "text/plain");
    if (!put.ok) throw new Error(`putBlob failed: ${put.error.kind}`);
    return put.value;
  });
  await store.opened.close();
  return refs;
}

/** 빈 저장소 파일만 만든다 */
async function createEmpty(path: string): Promise<void> {
  const opened = await openStore(directOptions(path).options);
  if (!opened.ok) throw new Error(`setup failed: ${opened.error.kind}`);
  await opened.value.close();
}

function blobPathOf(dir: string, ref: BlobRef): string {
  return join(dir, "blobs", ref.sha256.slice(0, 2), ref.sha256.slice(2));
}

describe("exportDatabase", () => {
  test("the export opens as a store with the same rows and blob bytes", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    const [ref] = await seedStore(source, clock, [BYTES]);
    if (ref === undefined) throw new Error("no blob ref");

    const exported = exportDatabase({ dbPath: source, destDir: join(dir.path, "out"), clock });
    expect(exported).toEqual({
      ok: true,
      value: {
        destDir: join(dir.path, "out"),
        exportedAt: clock.now(),
        blobCount: 1,
        missingBlobs: [],
      },
    });
    const manifest: unknown = JSON.parse(
      readFileSync(join(dir.path, "out", "manifest.json"), "utf8"),
    );
    expect(manifest).toEqual({
      format: 1,
      exportedAt: clock.now(),
      sqliteFile: "fresnel.sqlite",
      blobCount: 1,
      missingBlobs: [],
    });
    expect(statSync(join(dir.path, "out")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir.path, "out", "fresnel.sqlite")).mode & 0o777).toBe(0o600);
    expect(statSync(blobPathOf(join(dir.path, "out"), ref)).mode & 0o777).toBe(0o600);

    const copy = await openTestStore({
      path: join(dir.path, "out", "fresnel.sqlite"),
      clock,
      ids: fixedIdFactory(clock),
    });
    own(copy);
    expect(probeRows(copy)).toEqual([
      { id: 1, body: "a" },
      { id: 2, body: "b" },
    ]);
    expect(blobRows(copy)).toEqual([
      { sha256: ref.sha256, size: BYTES.byteLength, media_type: "text/plain" },
    ]);
    expect(copy.service.readBlob(ref)).toEqual({ ok: true, value: new Uint8Array(BYTES) });
  });

  test("a database whose -wal and -shm are gone (clean shutdown) can be exported", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    await seedStore(source, clock, [BYTES]);
    rmSync(`${source}-wal`, { force: true });
    rmSync(`${source}-shm`, { force: true });
    const exported = exportDatabase({ dbPath: source, destDir: join(dir.path, "out"), clock });
    expect(exported).toEqual({
      ok: true,
      value: {
        destDir: join(dir.path, "out"),
        exportedAt: clock.now(),
        blobCount: 1,
        missingBlobs: [],
      },
    });
    const copy = await openTestStore({
      path: join(dir.path, "out", "fresnel.sqlite"),
      clock,
      ids: fixedIdFactory(clock),
    });
    own(copy);
    expect(probeRows(copy)).toEqual([
      { id: 1, body: "a" },
      { id: 2, body: "b" },
    ]);
  });

  test("a database written by a newer engine can be exported", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    await createEmpty(source);
    const newer = new Database(source);
    newer.run(
      `INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version)
       VALUES ('sys', 4, '${"1".repeat(64)}', 1, '9.9.9')`,
    );
    newer.close();

    const exported = exportDatabase({ dbPath: source, destDir: join(dir.path, "out"), clock });
    expect(exported.ok).toBe(true);
    const copy = new Database(join(dir.path, "out", "fresnel.sqlite"), { readonly: true });
    try {
      expect(
        copy.query("SELECT version FROM sys_migrations WHERE owner = 'sys' ORDER BY version").all(),
      ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    } finally {
      copy.close();
    }
  });

  test("a non-empty destination is refused and its content is untouched", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    await createEmpty(source);
    const dest = join(dir.path, "out");
    mkdirSync(dest);
    writeFileSync(join(dest, "keep.txt"), "keep me");

    expect(exportDatabase({ dbPath: source, destDir: dest, clock })).toEqual({
      ok: false,
      error: { kind: "dest_not_empty" },
    });
    expect(readdirSync(dest)).toEqual(["keep.txt"]);
    expect(readFileSync(join(dest, "keep.txt"), "utf8")).toBe("keep me");
  });

  test("a blob whose file is missing is listed in missingBlobs and the rest is copied", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    const [kept, lost] = await seedStore(source, clock, [BYTES, OTHER]);
    if (kept === undefined || lost === undefined) throw new Error("no blob refs");
    rmSync(blobPathOf(join(dir.path, "src"), lost));

    const exported = exportDatabase({ dbPath: source, destDir: join(dir.path, "out"), clock });
    expect(exported).toEqual({
      ok: true,
      value: {
        destDir: join(dir.path, "out"),
        exportedAt: clock.now(),
        blobCount: 1,
        missingBlobs: [lost.sha256],
      },
    });
    expect(existsSync(blobPathOf(join(dir.path, "out"), kept))).toBe(true);
    expect(existsSync(blobPathOf(join(dir.path, "out"), lost))).toBe(false);
  });

  test("a file that is not a database, or a database of another app, is refused and nothing is created", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const text = join(dir.path, "text.db");
    writeFileSync(text, "this is not sqlite at all, just some text");
    const dest = join(dir.path, "out");
    expect(exportDatabase({ dbPath: text, destDir: dest, clock })).toEqual({
      ok: false,
      error: { kind: "not_a_database" },
    });
    expect(existsSync(dest)).toBe(false);

    const foreign = join(dir.path, "foreign.db");
    const other = new Database(foreign);
    other.run("CREATE TABLE notes (body TEXT)");
    other.close();
    expect(exportDatabase({ dbPath: foreign, destDir: dest, clock })).toEqual({
      ok: false,
      error: { kind: "foreign_database", applicationId: 0 },
    });
    expect(existsSync(dest)).toBe(false);
  });
});

/** 파일 시스템 오류처럼 code를 가진 예외. 내보내기는 code로 분류한다 */
function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: injected`), { code });
}

describe("exportDatabase under a concurrent removal", () => {
  test("a blob directory removed before cleanup does not replace the original error", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    const [ref] = await seedStore(source, clock, [BYTES]);
    if (ref === undefined) throw new Error("no blob ref");
    const dest = join(dir.path, "out");
    const shard = join(dest, "blobs", ref.sha256.slice(0, 2));

    const exported = exportDatabase({
      dbPath: source,
      destDir: dest,
      clock,
      faults: {
        // 복사 직전 지점: 다른 쪽이 블롭 디렉터리를 먼저 지운 뒤 복사가 I/O 오류를 낸다. 정리는 이미 없는 디렉터리를 지우게 된다
        hit: (): void => {
          rmSync(shard, { recursive: true, force: true });
          throw fsError("EIO");
        },
      },
    });
    expect(exported).toEqual({ ok: false, error: { kind: "io", code: "EIO" } });
    expect(existsSync(dest)).toBe(false);
  });

  test("a blob removed between its check and its copy is io ENOENT and leaves nothing behind", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    const [ref] = await seedStore(source, clock, [BYTES]);
    if (ref === undefined) throw new Error("no blob ref");
    const dest = join(dir.path, "out");

    const exported = exportDatabase({
      dbPath: source,
      destDir: dest,
      clock,
      faults: {
        // 복사 직전 지점: 확인을 통과한 블롭 파일이 복사 전에 사라진다
        hit: (): void => {
          rmSync(blobPathOf(join(dir.path, "src"), ref));
        },
      },
    });
    expect(exported).toEqual({ ok: false, error: { kind: "io", code: "ENOENT" } });
    expect(existsSync(dest)).toBe(false);
  });

  test("when cleanup fails too, the cleanup error is returned and the original error is not (S-14)", async () => {
    const dir = own(tempDir());
    const clock = manualClock();
    const source = join(dir.path, "src", "fresnel.db");
    const [ref] = await seedStore(source, clock, [BYTES]);
    if (ref === undefined) throw new Error("no blob ref");
    const dest = join(dir.path, "out");
    const shard = join(dest, "blobs", ref.sha256.slice(0, 2));

    const exported = exportDatabase({
      dbPath: source,
      destDir: dest,
      clock,
      faults: {
        // 복사 직전 지점: 블롭 디렉터리에 남의 파일이 생긴 뒤 복사가 실패한다. 정리는 그 디렉터리를 지우지 못한다
        hit: (): void => {
          writeFileSync(join(shard, "foreign.txt"), "not ours");
          throw fsError("EIO");
        },
      },
    });
    expect(exported).toEqual({ ok: false, error: { kind: "io", code: "ENOTEMPTY" } });
    expect(readFileSync(join(shard, "foreign.txt"), "utf8")).toBe("not ours");
  });
});
