import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { openMeasureStore, type MeasureRecord } from "../../../src/assembly/measure/store.ts";

// T-MEAS-STORE: 측정 저장소. 원본은 보존 기간이 지나면 일별 집계로 접히고 지워지며, 집계는 남는다. 백분위는 원본 정렬로 계산한다.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

function open(): ReturnType<typeof openMeasureStore> & { readonly ok: true } {
  const opened = openMeasureStore(":memory:");
  if (!opened.ok) throw new Bug("the in-memory measure store must open");
  return opened;
}

function turn(at: number, turnId: string, totalTokens: number, usd: number): MeasureRecord {
  return {
    at,
    threadId: "thr_a",
    turnId,
    kind: "turn",
    metrics: { totalTokens, usd },
    tags: { status: "completed" },
  };
}

test("a batch is written once and a Turn reads back its rows with metrics and tags", () => {
  const store = open().value;
  expect(store.writeBatch([turn(NOW, "trn_1", 100, 0.5), turn(NOW + 1, "trn_2", 200, 1)])).toEqual({
    ok: true,
    value: 2,
  });
  expect(store.writeBatch([])).toEqual({ ok: true, value: 0 });
  expect(store.rawCount()).toEqual({ ok: true, value: 2 });
  expect(store.turn("thr_a", "trn_2")).toEqual({
    ok: true,
    value: [turn(NOW + 1, "trn_2", 200, 1)],
  });
});

test("prune folds raw rows older than the retention into daily aggregates and deletes them", () => {
  const store = open().value;
  store.writeBatch([
    turn(NOW - 40 * DAY, "trn_old1", 100, 1),
    turn(NOW - 40 * DAY + 1000, "trn_old2", 300, 3),
    turn(NOW - 5 * DAY, "trn_new", 50, 0.25),
  ]);
  expect(store.prune(NOW, 30)).toEqual({ ok: true, value: 2 });
  expect(store.rawCount()).toEqual({ ok: true, value: 1 });
  const oldDay = new Date(NOW - 40 * DAY).toISOString().slice(0, 10);
  const newDay = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
  expect(store.daily("turn", "totalTokens")).toEqual({
    ok: true,
    value: [
      { day: oldDay, kind: "turn", metric: "totalTokens", count: 2, sum: 400, min: 100, max: 300 },
      { day: newDay, kind: "turn", metric: "totalTokens", count: 1, sum: 50, min: 50, max: 50 },
    ],
  });
  // 두 번째 정리는 이미 접은 행을 다시 세지 않는다
  expect(store.prune(NOW, 30)).toEqual({ ok: true, value: 0 });
  expect(store.daily("turn", "usd")).toEqual({
    ok: true,
    value: [
      { day: oldDay, kind: "turn", metric: "usd", count: 2, sum: 4, min: 1, max: 3 },
      { day: newDay, kind: "turn", metric: "usd", count: 1, sum: 0.25, min: 0.25, max: 0.25 },
    ],
  });
});

test("a retention of zero days deletes nothing", () => {
  const store = open().value;
  store.writeBatch([turn(NOW - 400 * DAY, "trn_x", 1, 0)]);
  expect(store.prune(NOW, 0)).toEqual({ ok: true, value: 0 });
  expect(store.rawCount()).toEqual({ ok: true, value: 1 });
});

test("percentile ranks the sorted raw values and ignores rows before since", () => {
  const store = open().value;
  store.writeBatch(
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((tokens, index) =>
      turn(NOW + index, `trn_${String(index)}`, tokens, 0),
    ),
  );
  store.writeBatch([turn(NOW - DAY, "trn_before", 1000, 0)]);
  expect(store.percentile("turn", "totalTokens", 0.5, NOW)).toEqual({ ok: true, value: 50 });
  expect(store.percentile("turn", "totalTokens", 0.95, NOW)).toEqual({ ok: true, value: 100 });
  expect(store.percentile("turn", "totalTokens", 0.5, NOW + 99_999)).toEqual({
    ok: true,
    value: undefined,
  });
  expect(store.percentile("turn", "nope", 0.5, 0)).toEqual({ ok: true, value: undefined });
});

test("after close every call is a closed error value, not a throw", () => {
  const store = open().value;
  store.close();
  store.close();
  expect(store.writeBatch([turn(NOW, "trn_1", 1, 0)])).toEqual({
    ok: false,
    error: { kind: "closed" },
  });
});
