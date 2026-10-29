import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BlobRef } from "@xeon/contracts/records";
import { sha256Hex } from "../src/hash.ts";
import { openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const GRACE = 600_000;
const SECOND = 1000;

async function open(): Promise<{ store: TestStore; clock: ManualClock; blobsDir: string }> {
  const clock = manualClock();
  const store = own(
    await openTestStore({ clock, ids: fixedIdFactory(clock), settings: { blobGraceMs: GRACE } }),
  );
  return { store, clock, blobsDir: join(dirname(store.path), "blobs") };
}

function put(store: TestStore, text: string): BlobRef {
  const result = store.service.putBlob(new TextEncoder().encode(text), "text/plain");
  if (!result.ok) throw new Error(`putBlob failed: ${result.error.kind}`);
  return result.value;
}

function pathOf(blobsDir: string, sha256: string): string {
  return join(blobsDir, sha256.slice(0, 2), sha256.slice(2));
}

function rowHashes(store: TestStore): readonly string[] {
  const rows = store.root.read((tx) => tx.all("SELECT sha256 FROM sys_blobs ORDER BY sha256"));
  if (!rows.ok) throw new Error("read failed");
  return rows.value.map((row) => String(row["sha256"]));
}

function age(path: string, clock: ManualClock, ms: number): void {
  const at = (clock.now() - ms) / SECOND;
  utimesSync(path, at, at);
}

describe("blob gc", () => {
  test("pinBlob keeps a referenced blob and gc removes only unreferenced ones", async () => {
    const { store, clock, blobsDir } = await open();
    store.service.extensions.register("acme-notes");
    const pinned = put(store, "pinned");
    const orphan = put(store, "orphan");
    const live = put(store, "live in events");
    expect(store.service.pinBlob("ext.acme-notes", pinned.sha256, "note:1")).toEqual({
      ok: true,
      value: undefined,
    });
    await clock.advance(GRACE + 1);

    const report = store.opened.gcBlobs({ liveRefs: new Set([live.sha256]) });
    expect(report).toEqual({
      ok: true,
      value: { rows: 1, orphanFiles: 0, tmpFiles: 0, deferred: 0, truncated: false },
    });
    expect(rowHashes(store)).toEqual([live.sha256, pinned.sha256].toSorted());
    expect(existsSync(pathOf(blobsDir, orphan.sha256))).toBe(false);
    expect(existsSync(pathOf(blobsDir, pinned.sha256))).toBe(true);
    const read = store.service.readBlob(live);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("live in events");

    expect(store.service.unpinBlob("ext.acme-notes", "note:1")).toEqual({ ok: true, value: 1 });
    store.opened.gcBlobs({ liveRefs: new Set([live.sha256]) });
    expect(rowHashes(store)).toEqual([live.sha256]);
  });

  test("keeps an unreferenced blob inside the grace period and after a re-put", async () => {
    const { store, clock, blobsDir } = await open();
    const old = put(store, "old");
    await clock.advance(GRACE + 1);
    put(store, "old"); // last_put_at refreshed: grace restarts
    const fresh = put(store, "fresh");
    const report = store.opened.gcBlobs({ liveRefs: new Set() });
    expect(report.ok && report.value.rows).toBe(0);
    expect(rowHashes(store)).toEqual([fresh.sha256, old.sha256].toSorted());
    expect(existsSync(pathOf(blobsDir, old.sha256))).toBe(true);
  });

  test("removes stray files and tmp files older than the grace period only", async () => {
    const { store, clock, blobsDir } = await open();
    const strayOld = sha256Hex(new TextEncoder().encode("stray-old"));
    const strayNew = sha256Hex(new TextEncoder().encode("stray-new"));
    const strayLive = sha256Hex(new TextEncoder().encode("stray-live"));
    const files = [strayOld, strayNew, strayLive].map((sha) => pathOf(blobsDir, sha));
    for (const [index, sha] of [strayOld, strayNew, strayLive].entries()) {
      const dir = join(blobsDir, sha.slice(0, 2));
      writeFileSyncWithDir(dir, join(dir, sha.slice(2)), "x");
      const file = files[index];
      if (file === undefined) throw new Error("unreachable");
      if (sha !== strayNew) age(file, clock, GRACE + 1000);
    }
    const tmpOld = join(blobsDir, "tmp", "a.tmp");
    const tmpNew = join(blobsDir, "tmp", "b.tmp");
    writeFileSync(tmpOld, "t");
    writeFileSync(tmpNew, "t");
    age(tmpOld, clock, GRACE + 1000);
    age(tmpNew, clock, 1000);

    const report = store.opened.gcBlobs({ liveRefs: new Set([strayLive]) });
    expect(report).toEqual({
      ok: true,
      value: { rows: 0, orphanFiles: 1, tmpFiles: 1, deferred: 0, truncated: false },
    });
    expect(existsSync(pathOf(blobsDir, strayOld))).toBe(false);
    expect(existsSync(pathOf(blobsDir, strayNew))).toBe(true);
    expect(existsSync(pathOf(blobsDir, strayLive))).toBe(true);
    expect(readdirSync(join(blobsDir, "tmp"))).toEqual(["b.tmp"]);
  });

  test("pinBlob reports blob_missing for unknown hashes and rejects unregistered owners", async () => {
    const { store } = await open();
    store.service.extensions.register("acme-notes");
    const unknown = sha256Hex(new TextEncoder().encode("nothing"));
    expect(store.service.pinBlob("ext.acme-notes", unknown, "k")).toEqual({
      ok: false,
      error: { kind: "blob_missing", sha256: unknown },
    });
    const ref = put(store, "x");
    expect(() => store.service.pinBlob("ext.nobody", ref.sha256, "k")).toThrow(
      "store.prefix_not_owned",
    );
    expect(() => store.service.pinBlob("sys", ref.sha256, "k")).toThrow("store.prefix_not_owned");
  });
});

function writeFileSyncWithDir(dir: string, file: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
}
