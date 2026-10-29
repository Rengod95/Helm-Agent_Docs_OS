import { afterEach, describe, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import type { BlobError } from "@xeon/contracts/records";
import type { TestStore } from "@xeon/platform-store/testing";
import {
  cacheKeyOf,
  createFetchCache,
  rawRefOf,
  type FetchCache,
  type SaveInput,
} from "../src/cache/fetch-cache.ts";
import type { WebStorePort } from "../src/ports/store.ts";
import { sha256Hex } from "../src/util/hash.ts";
import { manualClock, type ManualClock } from "./support/clock.ts";
import { openWebStore, releaseStores } from "./support/store.ts";

// 원문 행(cap_web_raw)이 가리키는 블롭은 cap.web 소유로 rawRef에 고정한다. 행이 지워질 때만 고정을 푼다.

const MINUTE = 60_000;
const GRACE = 1000;
const OWNER = "cap.web";

type PinEvent =
  | { readonly op: "pin"; readonly owner: string; readonly sha256: string; readonly refKey: string }
  | { readonly op: "unpin"; readonly owner: string; readonly refKey: string };

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function saveInput(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    cacheKey: cacheKeyOf({
      urlNorm: "https://a.example/",
      format: "markdown",
      render: "auto",
      provider: "local",
    }),
    url: "https://a.example/?utm_source=x",
    urlNorm: "https://a.example/",
    finalUrl: "https://a.example/",
    provider: "local",
    status: 200,
    contentType: "text/html",
    method: "readability",
    title: "Hello",
    publishedAt: "2026-10-01",
    retention: "persist",
    sessionId: undefined,
    rawBytes: enc("<html><body>hello</body></html>"),
    text: "# Hello\n\nhello",
    ttlMs: 15 * MINUTE,
    writeCacheRow: true,
    ...overrides,
  };
}

/** 실제 저장소 위에서 고정·해제 호출을 순서대로 적는 포트 */
function recording(store: TestStore): { readonly port: WebStorePort; readonly events: PinEvent[] } {
  const events: PinEvent[] = [];
  const service = store.service;
  const port: WebStorePort = {
    scoped: (owner) => service.scoped(owner),
    putBlob: (bytes, mediaType) => service.putBlob(bytes, mediaType),
    readBlob: (ref) => service.readBlob(ref),
    migrations: service.migrations,
    pinBlob(owner, sha256, refKey) {
      events.push({ op: "pin", owner, sha256, refKey });
      return service.pinBlob(owner, sha256, refKey);
    },
    unpinBlob(owner, refKey) {
      events.push({ op: "unpin", owner, refKey });
      return service.unpinBlob(owner, refKey);
    },
  };
  return { port, events };
}

interface Harness {
  readonly clock: ManualClock;
  readonly store: TestStore;
  readonly cache: FetchCache;
  readonly events: PinEvent[];
}

async function setup(): Promise<Harness> {
  const clock = manualClock();
  const store = await openWebStore(clock, { blobGraceMs: GRACE });
  const { port, events } = recording(store);
  const cache = createFetchCache({ store: port, clock });
  expect(cache.migrate().ok).toBe(true);
  return { clock, store, cache, events };
}

/** 유예 기간을 넘겨 GC를 한 번 돌린다. 고정되지 않았고 행도 없는 블롭만 지워진다 */
function gcAfterGrace(harness: Harness): void {
  harness.clock.advance(GRACE + 1);
  const report = harness.store.opened.gcBlobs({ liveRefs: new Set() });
  expect(report.ok).toBe(true);
}

afterEach(releaseStores);

describe("fetch cache pins the blobs of each raw row", () => {
  test("saving a page pins its raw and text blobs under the raw row", async () => {
    const { cache, events } = await setup();
    const input = saveInput();
    const rawRef = rawRefOf(input.rawBytes);
    expect(cache.save(input).ok).toBe(true);
    expect(events).toEqual([
      { op: "unpin", owner: OWNER, refKey: rawRef },
      { op: "pin", owner: OWNER, sha256: sha256Hex(input.rawBytes), refKey: rawRef },
      {
        op: "pin",
        owner: OWNER,
        sha256: sha256Hex(enc(input.text)),
        refKey: rawRef,
      },
    ]);
  });

  test("saving the same bytes with a new text releases the old text pin", async () => {
    const harness = await setup();
    const { store, cache, events } = harness;
    const first = saveInput({ text: "# Hello\n\nfirst" });
    const second = saveInput({ text: "# Hello\n\nsecond" });
    const rawRef = rawRefOf(first.rawBytes);
    expect(cache.save(first).ok).toBe(true);
    events.splice(0);

    expect(cache.save(second).ok).toBe(true);
    expect(events).toEqual([
      { op: "unpin", owner: OWNER, refKey: rawRef },
      { op: "pin", owner: OWNER, sha256: sha256Hex(first.rawBytes), refKey: rawRef },
      { op: "pin", owner: OWNER, sha256: sha256Hex(enc(second.text)), refKey: rawRef },
    ]);

    // 세 블롭(원문, 첫 본문, 둘째 본문) 가운데 첫 본문만 어느 행도 고정하지 않으므로 GC가 지운다
    expect((await store.rowCounts())["sys_blobs"]).toBe(3);
    gcAfterGrace(harness);
    const counts = await store.rowCounts();
    expect(counts["sys_blobs"]).toBe(2);
    expect(counts["sys_blob_refs"]).toBe(2);
  });

  test("gc keeps a saved page's blobs until its raw row is swept", async () => {
    const harness = await setup();
    const { store, cache, events } = harness;
    const input = saveInput();
    expect(cache.save(input).ok).toBe(true);

    gcAfterGrace(harness);
    expect((await store.rowCounts())["sys_blobs"]).toBe(2);

    events.splice(0);
    const swept = cache.sweep(0);
    expect(swept.ok && swept.value.removed).toBe(1);
    expect(events).toEqual([{ op: "unpin", owner: OWNER, refKey: rawRefOf(input.rawBytes) }]);

    gcAfterGrace(harness);
    expect((await store.rowCounts())["sys_blobs"]).toBe(0);
  });

  test("purging dead sessions releases only the raw rows it deletes", async () => {
    const { cache, events } = await setup();
    const gone = saveInput({
      retention: "session",
      sessionId: "thr_gone",
      rawBytes: enc("gone"),
    });
    const live = saveInput({
      retention: "session",
      sessionId: "thr_live",
      rawBytes: enc("live"),
    });
    expect(cache.save(gone).ok).toBe(true);
    expect(cache.save(live).ok).toBe(true);
    events.splice(0);

    const purged = cache.purgeSessionRaw(new Set(["thr_live"]));
    expect(purged.ok && purged.value.removed).toBe(1);
    expect(events).toEqual([{ op: "unpin", owner: OWNER, refKey: rawRefOf(gone.rawBytes) }]);
  });

  test("a failed pin is returned as a blob error", async () => {
    const clock = manualClock();
    const store = await openWebStore(clock, { blobGraceMs: GRACE });
    const { port } = recording(store);
    const ioFailure: BlobError = { kind: "io", code: "EIO" };
    const failing: WebStorePort = { ...port, pinBlob: () => err(ioFailure) };
    const cache = createFetchCache({ store: failing, clock });
    expect(cache.migrate().ok).toBe(true);

    const saved = cache.save(saveInput());
    expect(saved.ok).toBe(false);
    expect(saved.ok ? undefined : saved.error).toEqual({ kind: "blob", error: ioFailure });
  });
});
