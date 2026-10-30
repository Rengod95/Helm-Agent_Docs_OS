import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { err, ok, type Clock, type Logger } from "@xeon/contracts";
import type { SessionService } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { openTestStore, type TestStore } from "@xeon/platform-store/testing";
import {
  BLOB_GC_FIRST_RUN_MS,
  DATA_OPS_DAY_MS,
  startDataOps,
  type DataOpsDeps,
  type DataOpsSetTimer,
} from "../../src/assembly/data-ops.ts";
import { createManualScheduler, type ManualScheduler } from "../fixtures/manual-scheduler.ts";
import { partial } from "../fixtures/unsafe.ts";

// L4.host-service.spec §4.17 (보관 정리와 블롭 GC 연결). 시계와 타이머는 수동으로 흘리고, 블롭 GC는 실제 임시 저장소로 본다.

interface Logged {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: unknown;
}

function recorder(): { readonly logger: Logger; readonly lines: Logged[] } {
  const lines: Logged[] = [];
  const logger: Logger = {
    debug: (event, fields) => {
      lines.push({ level: "debug", event, fields });
    },
    info: (event, fields) => {
      lines.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      lines.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      lines.push({ level: "error", event, fields });
    },
    child: () => logger,
  };
  return { logger, lines };
}

function timerOf(scheduler: ManualScheduler): DataOpsSetTimer {
  return (ms, fn) => {
    const handle = scheduler.setTimeout(fn, ms);
    return () => {
      scheduler.clearTimeout(handle);
    };
  };
}

const DAY = DATA_OPS_DAY_MS;
const GRACE = 600_000;
/** 시험 시계. 실제 시간을 쓰지 않는다 */
let now = 1_700_000_000_000;
const clock: Clock = { now: () => now };
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** 상태 디렉터리 아래 spill 폴더를 만든다. 하나는 열 시각보다 10일, 다른 하나는 1일 전 것이다 */
function stateWithSpill(): {
  readonly state: string;
  readonly old: string;
  readonly fresh: string;
} {
  const state = mkdtempSync(join(tmpdir(), "xeon-data-ops-"));
  cleanups.push(async () => {
    rmSync(state, { recursive: true, force: true });
  });
  const spill = join(state, "spill");
  mkdirSync(spill, { recursive: true });
  const old = join(spill, "old.txt");
  const fresh = join(spill, "fresh.txt");
  writeFileSync(old, "x".repeat(10));
  writeFileSync(fresh, "y".repeat(5));
  utimesSync(old, (now - 10 * DAY) / 1000, (now - 10 * DAY) / 1000);
  utimesSync(fresh, (now - DAY) / 1000, (now - DAY) / 1000);
  return { state, old, fresh };
}

function spillDeps(
  state: string,
  retentionDays: () => number,
  scheduler: ManualScheduler,
  logger: Logger,
): DataOpsDeps {
  return {
    stateDir: state,
    clock,
    logger,
    setTimer: timerOf(scheduler),
    spillRetentionDays: retentionDays,
    blobGcEnabled: () => false,
    runsBlobGc: false,
    store: partial<DataOpsDeps["store"]>({}),
    query: partial<DataOpsDeps["query"]>({}),
  };
}

describe("spill retention", () => {
  test("retention 0 deletes nothing, on open or on later days", () => {
    const { state, old, fresh } = stateWithSpill();
    const scheduler = createManualScheduler();
    const { logger, lines } = recorder();
    startDataOps(spillDeps(state, () => 0, scheduler, logger));
    scheduler.advance(3 * DAY);
    expect([existsSync(old), existsSync(fresh)]).toEqual([true, true]);
    expect(lines).toEqual([]);
  });

  test("retention 7 days deletes only the files older than seven days and logs the count", () => {
    const { state, old, fresh } = stateWithSpill();
    const scheduler = createManualScheduler();
    const { logger, lines } = recorder();
    startDataOps(spillDeps(state, () => 7, scheduler, logger));
    expect([existsSync(old), existsSync(fresh)]).toEqual([false, true]);
    expect(lines).toEqual([
      { level: "info", event: "spill.pruned", fields: { removed: 1, bytesFreed: 10, failed: 0 } },
    ]);
  });

  test("the prune runs again once a day, so a file that became old is removed then", () => {
    const { state } = stateWithSpill();
    const scheduler = createManualScheduler();
    const { logger } = recorder();
    startDataOps(spillDeps(state, () => 7, scheduler, logger));
    const later = join(state, "spill", "later.txt");
    writeFileSync(later, "z");
    utimesSync(later, (now - 8 * DAY) / 1000, (now - 8 * DAY) / 1000);
    expect(existsSync(later)).toBe(true);
    scheduler.advance(DAY);
    expect(existsSync(later)).toBe(false);
  });

  test("close cancels the pending day timer", () => {
    const { state, old } = stateWithSpill();
    const scheduler = createManualScheduler();
    const { logger } = recorder();
    const ops = startDataOps(spillDeps(state, () => 0, scheduler, logger));
    ops.close();
    expect(scheduler.pending).toBe(0);
    expect(existsSync(old)).toBe(true);
  });
});

/** 블롭 GC 시험용 실제 저장소. 블롭은 `blobGraceMs`보다 오래되어야 지울 수 있다 */
async function openBlobStore(): Promise<TestStore> {
  const store = await openTestStore({
    clock,
    ids: fixedIdFactory(),
    settings: { blobGraceMs: GRACE },
  });
  cleanups.push(async () => {
    await store[Symbol.asyncDispose]();
  });
  return store;
}

function putText(store: TestStore, text: string): string {
  const put = store.service.putBlob(new TextEncoder().encode(text), "text/plain");
  if (!put.ok) throw new Error(`putBlob failed: ${put.error.kind}`);
  return put.value.sha256;
}

function hashesOf(store: TestStore): readonly string[] {
  const rows = store.root.read((tx) => tx.all("SELECT sha256 FROM sys_blobs ORDER BY sha256"));
  if (!rows.ok) throw new Error("read failed");
  return rows.value.map((row) => String(row["sha256"]));
}

/** 블롭 세 개: 아무도 쓰지 않는 것, 이벤트가 참조하는 것(`liveBlobRefs`), 고정된 것(`pinBlob`) */
function threeBlobs(store: TestStore): {
  readonly orphan: string;
  readonly live: string;
  readonly pinned: string;
} {
  const orphan = putText(store, "orphan");
  const live = putText(store, "referenced by an event");
  const pinned = putText(store, "pinned by an extension");
  store.service.extensions.register("acme-notes");
  const pin = store.service.pinBlob("ext.acme-notes", pinned, "note:1");
  if (!pin.ok) throw new Error(`pinBlob failed: ${pin.error.kind}`);
  return { orphan, live, pinned };
}

function gcDeps(
  store: TestStore,
  scheduler: ManualScheduler,
  logger: Logger,
  options: { readonly enabled: boolean; readonly liveRefs: readonly string[] },
): DataOpsDeps {
  return {
    stateDir: store.path,
    clock,
    logger,
    setTimer: timerOf(scheduler),
    spillRetentionDays: () => 0,
    blobGcEnabled: () => options.enabled,
    runsBlobGc: true,
    store: store.opened,
    query: partial<SessionService["query"]>({
      liveBlobRefs: () => ok(options.liveRefs),
    }),
  };
}

describe("blob GC", () => {
  test("with blobGcEnabled false nothing is deleted, even after the first run", async () => {
    const store = await openBlobStore();
    const { orphan, live, pinned } = threeBlobs(store);
    now += GRACE + 1;
    const scheduler = createManualScheduler();
    const { logger, lines } = recorder();
    startDataOps(gcDeps(store, scheduler, logger, { enabled: false, liveRefs: [live] }));
    scheduler.advance(BLOB_GC_FIRST_RUN_MS);
    expect(hashesOf(store)).toEqual([orphan, live, pinned].toSorted());
    expect(lines.filter((line) => line.event.startsWith("store.blob_gc"))).toEqual([]);
  });

  test("with blobGcEnabled true an unreferenced old blob goes, a referenced or pinned one stays", async () => {
    const store = await openBlobStore();
    const { orphan, live, pinned } = threeBlobs(store);
    now += GRACE + 1;
    const scheduler = createManualScheduler();
    const { logger, lines } = recorder();
    startDataOps(gcDeps(store, scheduler, logger, { enabled: true, liveRefs: [live] }));
    expect(hashesOf(store)).toEqual([orphan, live, pinned].toSorted());
    scheduler.advance(BLOB_GC_FIRST_RUN_MS);
    expect(hashesOf(store)).toEqual([live, pinned].toSorted());
    expect(lines).toEqual([
      {
        level: "info",
        event: "store.blob_gc",
        fields: { rows: 1, orphanFiles: 0, tmpFiles: 0, deferred: 0, truncated: false },
      },
    ]);
  });

  test("a host that does not run scheduled work never starts the GC, even when enabled", () => {
    let calls = 0;
    const scheduler = createManualScheduler();
    const { logger } = recorder();
    startDataOps({
      stateDir: "/unused",
      clock,
      logger,
      setTimer: timerOf(scheduler),
      spillRetentionDays: () => 0,
      blobGcEnabled: () => true,
      runsBlobGc: false,
      store: partial<DataOpsDeps["store"]>({
        gcBlobs: () => {
          calls += 1;
          return err({ kind: "disk_full" });
        },
      }),
      query: partial<DataOpsDeps["query"]>({ liveBlobRefs: () => ok([]) }),
    });
    scheduler.advance(2 * DAY);
    expect(calls).toBe(0);
  });

  test("a failing GC is logged as store.blob_gc_failed and the next day's run still happens", () => {
    let calls = 0;
    const scheduler = createManualScheduler();
    const { logger, lines } = recorder();
    startDataOps({
      stateDir: "/unused",
      clock,
      logger,
      setTimer: timerOf(scheduler),
      spillRetentionDays: () => 0,
      blobGcEnabled: () => true,
      runsBlobGc: true,
      store: partial<DataOpsDeps["store"]>({
        gcBlobs: () => {
          calls += 1;
          return err({ kind: "disk_full" });
        },
      }),
      query: partial<DataOpsDeps["query"]>({ liveBlobRefs: () => ok([]) }),
    });
    scheduler.advance(BLOB_GC_FIRST_RUN_MS);
    scheduler.advance(DAY);
    expect(calls).toBe(2);
    expect(lines).toEqual([
      { level: "warn", event: "store.blob_gc_failed", fields: { kind: "disk_full" } },
      { level: "warn", event: "store.blob_gc_failed", fields: { kind: "disk_full" } },
    ]);
  });

  test("close cancels the first GC run before it fires", async () => {
    const store = await openBlobStore();
    const { orphan, live, pinned } = threeBlobs(store);
    now += GRACE + 1;
    const scheduler = createManualScheduler();
    const { logger } = recorder();
    const ops = startDataOps(gcDeps(store, scheduler, logger, { enabled: true, liveRefs: [live] }));
    ops.close();
    scheduler.advance(2 * DAY);
    expect(hashesOf(store)).toEqual([orphan, live, pinned].toSorted());
  });
});
