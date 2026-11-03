import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, type Logger } from "@fresnel/contracts";
import { startMeasurement } from "../../../src/assembly/measure/recorder.ts";
import { openMeasureStore } from "../../../src/assembly/measure/store.ts";

// T-MEAS-STORE: 보존 기간이 지나면 원본이 지워지고 일별 집계가 남는다. 요청 본문은 기본으로 저장하지 않고,
// 켜면 가린 뒤에만 저장하며 가릴 수단이 없으면 저장하지 않는다.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const THREAD = "thr_1";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const feed = { onCommit: () => () => undefined };
const usage = { subscribe: () => () => undefined };

function withDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "measure-retention-"));
  return work(dir).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Bug("the measure database must be readable");
  return result.value;
}

test("raw rows past the retention are deleted and the daily aggregate stays", async () => {
  await withDir(async (dir) => {
    const seed = must(openMeasureStore(join(dir, "measure.db")));
    must(
      seed.writeBatch([
        {
          at: NOW - 40 * DAY,
          threadId: THREAD,
          turnId: "trn_old",
          kind: "turn",
          metrics: { usd: 2 },
          tags: {},
        },
        {
          at: NOW - 40 * DAY,
          threadId: THREAD,
          turnId: "trn_old2",
          kind: "turn",
          metrics: { usd: 3 },
          tags: {},
        },
        {
          at: NOW - DAY,
          threadId: THREAD,
          turnId: "trn_new",
          kind: "turn",
          metrics: { usd: 5 },
          tags: {},
        },
      ]),
    );
    seed.close();

    const { stop } = startMeasurement({
      dir,
      session: { feed },
      usage,
      enabled: () => true,
      logger,
      now: () => NOW,
      retentionDays: () => 30,
    });
    stop();

    const peek = must(openMeasureStore(join(dir, "measure.db")));
    expect(must(peek.rawCount())).toBe(1);
    expect(must(peek.daily("turn", "usd"))).toEqual([
      { day: "2026-09-25", kind: "turn", metric: "usd", count: 2, sum: 5, min: 2, max: 3 },
      { day: "2026-11-03", kind: "turn", metric: "usd", count: 1, sum: 5, min: 5, max: 5 },
    ]);
    peek.close();
  });
});

test("a changed retention setting prunes on the next write batch after an hour", async () => {
  await withDir(async (dir) => {
    let now = NOW;
    let days = 30;
    const { stop, offerBody } = startMeasurement({
      dir,
      session: { feed },
      usage,
      enabled: () => true,
      logger,
      now: () => now,
      retentionDays: () => days,
      storeRequestBody: () => true,
      mask: (text) => text,
    });
    offerBody({ threadId: THREAD, turnId: null, stepIndex: 1, at: NOW - 2 * DAY, body: { a: 1 } });
    await Promise.resolve();
    now = NOW + 2 * 3_600_000;
    days = 1;
    offerBody({ threadId: THREAD, turnId: null, stepIndex: 2, at: now, body: { a: 2 } });
    await Promise.resolve();
    stop();

    const peek = must(openMeasureStore(join(dir, "measure.db")));
    expect(must(peek.rawCount())).toBe(1);
    expect(must(peek.daily("body", "chars"))).toEqual([
      { day: "2026-11-02", kind: "body", metric: "chars", count: 1, sum: 7, min: 7, max: 7 },
      { day: "2026-11-04", kind: "body", metric: "chars", count: 1, sum: 7, min: 7, max: 7 },
    ]);
    peek.close();
  });
});

async function bodyRows(options: {
  readonly store: boolean;
  readonly mask: ((text: string) => string) | undefined;
  readonly enabled?: boolean;
}): Promise<
  readonly {
    readonly metrics: Readonly<Record<string, number>>;
    readonly body: string | undefined;
  }[]
> {
  return withDir(async (dir) => {
    const { stop, offerBody } = startMeasurement({
      dir,
      session: { feed },
      usage,
      enabled: () => options.enabled ?? true,
      logger,
      now: () => NOW,
      storeRequestBody: () => options.store,
      ...(options.mask === undefined ? {} : { mask: options.mask }),
    });
    offerBody({
      threadId: THREAD,
      turnId: "trn_1",
      stepIndex: 3,
      at: NOW,
      body: { key: "sk-secret-value" },
    });
    await Promise.resolve();
    stop();
    const peek = must(openMeasureStore(join(dir, "measure.db")));
    const rows = must(peek.turn(THREAD, "trn_1"));
    peek.close();
    return rows.map((row) => ({ metrics: row.metrics, body: row.tags["body"] }));
  });
}

test("the request body is not stored by default", async () => {
  expect(await bodyRows({ store: false, mask: (text) => text })).toEqual([]);
});

test("when switched on the body is stored only after masking", async () => {
  expect(
    await bodyRows({ store: true, mask: (text) => text.replaceAll("sk-secret-value", "[masked]") }),
  ).toEqual([{ metrics: { step: 3, chars: 18, truncated: 0 }, body: '{"key":"[masked]"}' }]);
});

test("without a masking function nothing is stored even when switched on", async () => {
  expect(await bodyRows({ store: true, mask: undefined })).toEqual([]);
});

test("with measurement off the body is not stored either", async () => {
  expect(await bodyRows({ store: true, mask: (text) => text, enabled: false })).toEqual([]);
});
