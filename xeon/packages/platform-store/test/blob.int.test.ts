import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobRef } from "@xeon/contracts/records";
import { sha256Hex } from "../src/hash.ts";
import { openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { disposableWith } from "./support/fixture.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("hello blob store");

async function open(
  strictPrefix = true,
): Promise<{ store: TestStore; clock: ManualClock; blobsDir: string } & AsyncDisposable> {
  const clock = manualClock();
  const store = await openTestStore({ clock, ids: fixedIdFactory(clock), strictPrefix });
  return disposableWith(store, { store, clock, blobsDir: join(dirname(store.path), "blobs") });
}

function put(
  store: TestStore,
  bytes: Uint8Array,
  mediaType: string | null = "text/plain",
): BlobRef {
  const result = store.service.putBlob(bytes, mediaType);
  if (!result.ok) throw new Error(`putBlob failed: ${result.error.kind}`);
  return result.value;
}

function destOf(blobsDir: string, ref: BlobRef): string {
  return join(blobsDir, ref.sha256.slice(0, 2), ref.sha256.slice(2));
}

function blobRow(store: TestStore, sha256: string): Record<string, unknown> | undefined {
  const result = store.root.read((tx) =>
    tx.get("SELECT * FROM sys_blobs WHERE sha256 = ?", [sha256]),
  );
  return result.ok ? result.value : undefined;
}

describe("blob store", () => {
  test("writes a content addressed file and a row, and reads it back", async () => {
    const fixture = own(await open());
    const { store, blobsDir } = fixture;
    const ref = put(store, BYTES);
    expect(ref).toEqual({
      type: "blob",
      sha256: sha256Hex(BYTES),
      size: BYTES.byteLength,
      mediaType: "text/plain",
    });
    const dest = destOf(blobsDir, ref);
    expect(readFileSync(dest)).toEqual(Buffer.from(BYTES));
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(dest)).mode & 0o777).toBe(0o700);
    expect(blobRow(store, ref.sha256)).toMatchObject({
      size: BYTES.byteLength,
      media_type: "text/plain",
    });
    expect(store.service.readBlob(ref)).toEqual({ ok: true, value: new Uint8Array(BYTES) });
    expect(readdirSync(join(blobsDir, "tmp"))).toEqual([]);
  });

  test("empty blobs and a null media type are supported", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const ref = put(store, new Uint8Array(), null);
    expect(ref).toMatchObject({ size: 0, mediaType: null });
    expect(store.service.readBlob(ref)).toEqual({ ok: true, value: new Uint8Array() });
  });

  test("large blobs are written completely", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const big = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const ref = put(store, big, "application/octet-stream");
    const read = store.service.readBlob(ref);
    expect(read.ok && sha256Hex(read.value)).toBe(sha256Hex(big));
  });

  test("same blob is written once", async () => {
    const fixture = own(await open());
    const { store, clock, blobsDir } = fixture;
    const ref = put(store, BYTES);
    const dest = destOf(blobsDir, ref);
    const before = statSync(dest);
    const created = blobRow(store, ref.sha256)?.["created_at"];
    await clock.advance(60_000);
    expect(put(store, BYTES)).toEqual(ref);
    const after = statSync(dest);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(blobRow(store, ref.sha256)).toMatchObject({
      created_at: created,
      last_put_at: clock.now(),
    });
    expect((await store.rowCounts())["sys_blobs"]).toBe(1);
  });

  test("putBlob inside a transaction is a bug", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    expect(() => store.root.write(() => store.service.putBlob(BYTES, null))).toThrow(
      "store.nested_write",
    );
  });

  test("putBlob after close is a bug", async () => {
    const { store } = own(await open());
    await store.opened.close();
    expect(() => store.service.putBlob(BYTES, null)).toThrow("store.closed");
  });

  test("missing blob is reported", async () => {
    const fixture = own(await open());
    const { store, blobsDir } = fixture;
    const ref = put(store, BYTES);
    const dest = destOf(blobsDir, ref);
    writeFileSync(dest, "tiny");
    expect(store.service.readBlob(ref)).toEqual({
      ok: false,
      error: { kind: "blob_corrupt", sha256: ref.sha256, reason: "size" },
    });
    rmSync(dest);
    expect(store.service.readBlob(ref)).toEqual({
      ok: false,
      error: { kind: "blob_missing", sha256: ref.sha256 },
    });
  });

  test("malformed references never touch the file system", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const ref: BlobRef = { type: "blob", sha256: "../../etc/passwd", size: 1, mediaType: null };
    expect(store.service.readBlob(ref)).toEqual({
      ok: false,
      error: { kind: "blob_missing", sha256: "../../etc/passwd" },
    });
  });

  test.each([true, false])("hash verification on read with strict builds = %p", async (strict) => {
    const fixture = own(await open(strict));
    const { store, blobsDir } = fixture;
    const ref = put(store, BYTES);
    writeFileSync(destOf(blobsDir, ref), "x".repeat(BYTES.byteLength));
    const read = store.service.readBlob(ref);
    if (strict) {
      expect(read).toEqual({
        ok: false,
        error: { kind: "blob_corrupt", sha256: ref.sha256, reason: "hash" },
      });
    } else {
      expect(read.ok).toBe(true);
    }
  });

  test.skipIf(process.getuid?.() === 0)("an unwritable blob directory is an io error", async () => {
    const fixture = own(await open());
    const { store, blobsDir } = fixture;
    chmodSync(join(blobsDir, "tmp"), 0o500);
    try {
      expect(store.service.putBlob(BYTES, null)).toEqual({
        ok: false,
        error: { kind: "io", code: "EACCES" },
      });
      const sha = sha256Hex(BYTES);
      expect(existsSync(join(blobsDir, sha.slice(0, 2), sha.slice(2)))).toBe(false);
    } finally {
      chmodSync(join(blobsDir, "tmp"), 0o700);
    }
  });
});

describe("blob row write failures", () => {
  test("a busy database leaves the file but reports an io error", async () => {
    const clock = manualClock();
    const store = own(
      await openTestStore({ clock, ids: fixedIdFactory(clock), settings: { busyTimeoutMs: 0 } }),
    );
    const other = new Database(store.path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      expect(store.service.putBlob(BYTES, null)).toEqual({
        ok: false,
        error: { kind: "io", code: "SQLITE_BUSY" },
      });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
    // 같은 바이트를 다시 쓰면 파일은 건너뛰고 행만 남긴다
    expect(store.service.putBlob(BYTES, null).ok).toBe(true);
    expect((await store.rowCounts())["sys_blobs"]).toBe(1);
  });

  test("a full database reports disk_full", async () => {
    const { store } = own(await open());
    const pages = store.root.read((tx) => tx.get("PRAGMA page_count"));
    const count = Number(Object.values(pages.ok ? (pages.value ?? {}) : {})[0] ?? 0);
    store.root.write((tx) => tx.run(`PRAGMA max_page_count = ${count}`));
    const results = Array.from({ length: 40 }, (_, index) =>
      store.service.putBlob(new TextEncoder().encode(`blob number ${index}`), "x".repeat(3000)),
    );
    expect(results.some((result) => !result.ok && result.error.kind === "disk_full")).toBe(true);
  });
});

describe("blob pins", () => {
  test("pin and unpinAll work inside the event commit transaction", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const a = put(store, BYTES);
    const b = put(store, new TextEncoder().encode("another"));
    const { blobPins } = store.opened;
    const pinned = store.root.write((tx) => {
      blobPins.pin(tx, a.sha256, "core.persistence", "thread:t1");
      blobPins.pin(tx, a.sha256, "core.persistence", "thread:t1");
      blobPins.pin(tx, b.sha256, "core.persistence", "thread:t1");
      blobPins.pin(tx, a.sha256, "core.persistence", "thread:t2");
    });
    expect(pinned.ok).toBe(true);
    expect((await store.rowCounts())["sys_blob_refs"]).toBe(3);
    const removed = store.root.write((tx) =>
      blobPins.unpinAll(tx, "core.persistence", "thread:t1"),
    );
    expect(removed).toEqual({ ok: true, value: 2 });
    expect((await store.rowCounts())["sys_blob_refs"]).toBe(1);
  });

  test("pinning a blob that was never stored violates the foreign key", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    expect(() =>
      store.root.write((tx) =>
        store.opened.blobPins.pin(tx, "a".repeat(64), "core.persistence", "k"),
      ),
    ).toThrow();
    expect((await store.rowCounts())["sys_blob_refs"]).toBe(0);
  });
});
