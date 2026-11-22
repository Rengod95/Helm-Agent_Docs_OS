import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobStreamSource } from "@fresnel/contracts/records";
import { sha256Hex } from "../src/hash.ts";
import type { StoreSettings } from "../src/types.ts";
import { openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { disposableWith } from "./support/fixture.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const BYTES = new TextEncoder().encode("blob streamed in pieces");

async function open(
  settings?: Partial<StoreSettings>,
): Promise<{ store: TestStore; clock: ManualClock; blobsDir: string } & AsyncDisposable> {
  const clock = manualClock();
  const store = await openTestStore({
    clock,
    ids: fixedIdFactory(clock),
    ...(settings === undefined ? {} : { settings }),
  });
  return disposableWith(store, { store, clock, blobsDir: join(dirname(store.path), "blobs") });
}

/** 같은 바이트를 `step`씩 나눠 넘기는 원천. `reuse`면 한 버퍼를 되풀이해 채운다(조각은 `sink` 호출 동안만 유효하다) */
function streamOf(bytes: Uint8Array, step: number, reuse = false): BlobStreamSource {
  return {
    size: bytes.byteLength,
    produce(sink) {
      const buffer = reuse ? new Uint8Array(step) : undefined;
      for (let at = 0; at < bytes.byteLength; at += step) {
        const piece = bytes.subarray(at, Math.min(at + step, bytes.byteLength));
        if (buffer === undefined) {
          sink(piece);
        } else {
          buffer.set(piece);
          sink(buffer.subarray(0, piece.byteLength));
        }
      }
    },
  };
}

function tmpEntries(blobsDir: string): readonly string[] {
  return readdirSync(join(blobsDir, "tmp"));
}

/** 목적 경로의 두 글자 디렉터리. 파일을 쓰기 전에 거절된 자리에서는 없어야 한다 */
function prefixDirs(blobsDir: string): readonly string[] {
  return readdirSync(blobsDir).filter((name) => name !== "tmp");
}

describe("putBlobStream", () => {
  const VARIANTS: readonly (readonly [string, Uint8Array, number, boolean])[] = [
    ["one byte per piece", BYTES, 1, false],
    ["several pieces that do not divide the size", BYTES, 7, false],
    ["one piece for the whole input", BYTES, BYTES.byteLength, false],
    ["a reused buffer", BYTES, 5, true],
    [
      "a multi-megabyte input in 64 KiB pieces",
      new Uint8Array(3 * 1024 * 1024 + 11).map((_, index) => index % 251),
      64 * 1024,
      false,
    ],
  ];

  for (const [name, bytes, step, reuse] of VARIANTS) {
    test(`${name} gives the same reference and the same file as putBlob`, async () => {
      const streamed = own(await open());
      const buffered = own(await open());
      const viaStream = streamed.store.service.putBlobStream(
        streamOf(bytes, step, reuse),
        "text/plain",
      );
      const viaBuffer = buffered.store.service.putBlob(bytes, "text/plain");
      expect(viaStream).toEqual(viaBuffer);
      if (!viaStream.ok) throw new Error(`putBlobStream failed: ${viaStream.error.kind}`);
      expect(viaStream.value).toEqual({
        type: "blob",
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
        mediaType: "text/plain",
      });
      expect(streamed.store.service.readBlob(viaStream.value)).toEqual({
        ok: true,
        value: new Uint8Array(bytes),
      });
      expect(tmpEntries(streamed.blobsDir)).toEqual([]);
      expect((await streamed.store.rowCounts())["sys_blobs"]).toBe(1);
    });
  }

  test("an empty source writes an empty blob, with or without empty pieces", async () => {
    const fixture = own(await open());
    const { store } = fixture;
    const silent: BlobStreamSource = { size: 0, produce(): void {} };
    const empty: BlobStreamSource = {
      size: 0,
      produce(sink) {
        sink(new Uint8Array());
      },
    };
    const first = store.service.putBlobStream(silent, null);
    expect(first).toEqual({
      ok: true,
      value: { type: "blob", sha256: sha256Hex(new Uint8Array()), size: 0, mediaType: null },
    });
    expect(store.service.putBlobStream(empty, null)).toEqual(first);
    if (!first.ok) throw new Error(`putBlobStream failed: ${first.error.kind}`);
    expect(store.service.readBlob(first.value)).toEqual({ ok: true, value: new Uint8Array() });
  });

  test("the hash and size are those of the streamed bytes", async () => {
    const fixture = own(await open());
    const ref = fixture.store.service.putBlobStream(streamOf(BYTES, 4), "text/plain");
    expect(ref).toEqual({
      ok: true,
      value: {
        type: "blob",
        sha256: sha256Hex(BYTES),
        size: BYTES.byteLength,
        mediaType: "text/plain",
      },
    });
    expect(fixture.store.service.readBlobByHash(sha256Hex(BYTES))).toEqual({
      ok: true,
      value: new Uint8Array(BYTES),
    });
  });

  test("a source that produces a different byte count than declared is a bug and leaves no file or row", async () => {
    const fixture = own(await open());
    const { store, blobsDir } = fixture;
    const short: BlobStreamSource = {
      size: BYTES.byteLength + 1,
      produce(sink) {
        sink(BYTES);
      },
    };
    const long: BlobStreamSource = {
      size: BYTES.byteLength - 1,
      produce(sink) {
        sink(BYTES);
      },
    };
    expect(() => store.service.putBlobStream(short, null)).toThrow("store.blob_stream_size");
    expect(() => store.service.putBlobStream(long, null)).toThrow("store.blob_stream_size");
    expect(tmpEntries(blobsDir)).toEqual([]);
    expect(prefixDirs(blobsDir)).toEqual([]);
    expect((await store.rowCounts())["sys_blobs"]).toBe(0);
  });

  test("a size that is not a non-negative integer is a bug", async () => {
    const fixture = own(await open());
    for (const size of [-1, 1.5, Number.NaN]) {
      expect(() => fixture.store.service.putBlobStream({ size, produce(): void {} }, null)).toThrow(
        "store.blob_stream_size",
      );
    }
  });

  test("an error thrown by the producer is rethrown and leaves no temporary file", async () => {
    const fixture = own(await open());
    const { store, blobsDir } = fixture;
    const broken: BlobStreamSource = {
      size: BYTES.byteLength,
      produce(sink) {
        sink(BYTES.subarray(0, 3));
        throw new Error("source failed");
      },
    };
    expect(() => store.service.putBlobStream(broken, null)).toThrow("source failed");
    expect(tmpEntries(blobsDir)).toEqual([]);
    expect((await store.rowCounts())["sys_blobs"]).toBe(0);
  });

  test("a stream over the limit is refused before any file or row is written, and the producer never runs", async () => {
    const fixture = own(await open({ maxBlobBytes: 16 }));
    const { store, blobsDir } = fixture;
    const over = new TextEncoder().encode("0123456789abcdefX");
    let produced = false;
    const source: BlobStreamSource = {
      size: over.byteLength,
      produce(sink) {
        produced = true;
        sink(over);
      },
    };
    expect(store.service.putBlobStream(source, null)).toEqual({
      ok: false,
      error: { kind: "blob_too_large", size: 17, limit: 16 },
    });
    expect(produced).toBe(false);
    expect(prefixDirs(blobsDir)).toEqual([]);
    expect(tmpEntries(blobsDir)).toEqual([]);
    expect((await store.rowCounts())["sys_blobs"]).toBe(0);
  });

  test("streaming the same content twice keeps one file and one row, and the second call only refreshes the row", async () => {
    const fixture = own(await open());
    const { store, clock, blobsDir } = fixture;
    const first = store.service.putBlobStream(streamOf(BYTES, 6), "text/plain");
    if (!first.ok) throw new Error(`putBlobStream failed: ${first.error.kind}`);
    const dest = join(blobsDir, first.value.sha256.slice(0, 2), first.value.sha256.slice(2));
    const before = statSync(dest);
    await clock.advance(60_000);
    expect(store.service.putBlobStream(streamOf(BYTES, 9, true), "text/plain")).toEqual(first);
    const after = statSync(dest);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(tmpEntries(blobsDir)).toEqual([]);
    expect((await store.rowCounts())["sys_blobs"]).toBe(1);
  });

  test("putBlobStream inside a transaction is a bug", async () => {
    const { store } = own(await open());
    expect(() =>
      store.root.write(() => store.service.putBlobStream(streamOf(BYTES, 4), null)),
    ).toThrow("store.nested_write");
  });

  test("putBlobStream after close is a bug", async () => {
    const { store } = own(await open());
    await store.opened.close();
    expect(() => store.service.putBlobStream(streamOf(BYTES, 4), null)).toThrow("store.closed");
  });
});
