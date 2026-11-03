import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { createMeasurePort } from "../../../src/assembly/measure/read.ts";
import { openMeasureStore, type MeasureRecord } from "../../../src/assembly/measure/store.ts";

// T-MEAS-READ: 읽기 포트는 저장소의 한 Turn 행과 일별 집계를 그대로 낸다. 꺼져 있으면 빈 결과, 닫힌 저장소는 오류 값이다.

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

function call(at: number, firstTokenMs: number, turnId: string): MeasureRecord {
  return {
    at,
    threadId: "thr_a",
    turnId,
    kind: "call",
    metrics: { firstTokenMs },
    tags: { role: "main" },
  };
}

function openStore() {
  const opened = openMeasureStore(":memory:");
  if (!opened.ok) throw new Bug("the in-memory measure store must open");
  return opened.value;
}

test("turn gives that turn's rows without the ids, and daily sums the days in date order", () => {
  const store = openStore();
  store.writeBatch([
    call(T0, 100, "trn_1"),
    call(T0 + 5, 60, "trn_1"),
    call(T0 + DAY, 40, "trn_2"),
  ]);
  const port = createMeasurePort({ store: () => store, enabled: () => true });
  expect(port.turn("thr_a", "trn_1")).toEqual({
    ok: true,
    value: {
      enabled: true,
      rows: [
        { at: T0, kind: "call", metrics: { firstTokenMs: 100 }, tags: { role: "main" } },
        { at: T0 + 5, kind: "call", metrics: { firstTokenMs: 60 }, tags: { role: "main" } },
      ],
    },
  });
  expect(port.daily("call", "firstTokenMs")).toEqual({
    ok: true,
    value: {
      enabled: true,
      days: [
        { day: "2026-11-04", count: 2, sum: 160, min: 60, max: 100 },
        { day: "2026-11-05", count: 1, sum: 40, min: 40, max: 40 },
      ],
    },
  });
});

test("off or without a store the answers are empty and enabled says why, a closed store is an error value", () => {
  const store = openStore();
  store.writeBatch([call(T0, 100, "trn_1")]);
  const off = createMeasurePort({ store: () => store, enabled: () => false });
  expect(off.turn("thr_a", "trn_1")).toEqual({ ok: true, value: { enabled: false, rows: [] } });
  expect(off.daily("call", "firstTokenMs")).toEqual({
    ok: true,
    value: { enabled: false, days: [] },
  });
  const none = createMeasurePort({ store: () => undefined, enabled: () => true });
  expect(none.turn("thr_a", "trn_1")).toEqual({ ok: true, value: { enabled: true, rows: [] } });
  store.close();
  const closed = createMeasurePort({ store: () => store, enabled: () => true });
  expect(closed.turn("thr_a", "trn_1")).toEqual({ ok: false, error: { kind: "closed" } });
});
