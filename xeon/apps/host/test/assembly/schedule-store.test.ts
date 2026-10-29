import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EMPTY_STATE, type ScheduleState } from "@xeon/cap-schedule";
import { createFileScheduleStore } from "../../src/assembly/schedule-store.ts";

// 예약 저장소(L4.host-service.spec §4.17). 파일 하나에 상태를 쓰고, 없으면 빈 상태, 손상되면 값으로 실패한다.

const STATE: ScheduleState = {
  version: 1,
  entries: [
    {
      id: "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      trigger: { kind: "interval", everySeconds: 600 },
      prompt: "요약을 만든다",
      workspace: "/work/a",
      title: null,
      sessionKind: "cron",
      enabled: true,
      createdAt: 1_000,
      nextDueAt: 601_000,
      lastStartedAt: null,
      iterations: 0,
      stoppedReason: null,
    },
    {
      id: "sch_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      trigger: { kind: "loop", intervalSeconds: 300, maxIterations: 3, expiresAtMs: 9_000_000 },
      prompt: "빌드 상태를 확인한다",
      workspace: null,
      title: "빌드 확인",
      sessionKind: "cron",
      enabled: false,
      createdAt: 2_000,
      nextDueAt: null,
      lastStartedAt: 3_000,
      iterations: 2,
      stoppedReason: "max_iterations",
    },
  ],
  runs: [
    {
      runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      scheduleId: "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      firedBy: "interval",
      dueAt: 601_000,
      claimedAt: 601_000,
      missed: false,
      status: "finished",
      threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      startedAt: 601_000,
      endedAt: 602_500,
      outcome: "completed",
      reason: null,
      skippedCount: 0,
    },
  ],
};

let root = "";
let dir = "";
let file = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "schedule-store-"));
  dir = join(root, "schedule");
  file = join(dir, "state.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the schedule store", () => {
  test("a saved state loads back unchanged", async () => {
    const store = createFileScheduleStore(dir);
    expect(await store.save(STATE)).toEqual({ ok: true, value: undefined });
    expect(await store.load()).toEqual({ ok: true, value: STATE });
  });

  test("a missing file loads as the empty state", async () => {
    const store = createFileScheduleStore(dir);
    expect(await store.load()).toEqual({ ok: true, value: EMPTY_STATE });
  });

  test("a file that is not JSON is a store_failed value, not a throw", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "{ not json");
    const store = createFileScheduleStore(dir);
    expect(await store.load()).toMatchObject({ ok: false, error: { kind: "store_failed" } });
  });

  test("a file with another shape is a store_failed value and names the field", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 2, entries: [], runs: [] }));
    const store = createFileScheduleStore(dir);
    const loaded = await store.load();
    expect(loaded).toMatchObject({ ok: false, error: { kind: "store_failed" } });
    expect(loaded.ok ? "" : loaded.error.message).toContain("/version");
  });

  test("a save leaves only the state file behind and keeps the owner-only modes", async () => {
    const store = createFileScheduleStore(dir);
    await store.save(STATE);
    expect(readdirSync(dir)).toEqual(["state.json"]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("a second save replaces the first without leaving a temp file", async () => {
    const store = createFileScheduleStore(dir);
    await store.save(STATE);
    await store.save(EMPTY_STATE);
    expect(readdirSync(dir)).toEqual(["state.json"]);
    expect(await store.load()).toEqual({ ok: true, value: EMPTY_STATE });
  });

  test("a save into a path that cannot be a directory is a store_failed value", async () => {
    writeFileSync(join(root, "blocked"), "");
    const store = createFileScheduleStore(join(root, "blocked", "schedule"));
    expect(await store.save(STATE)).toMatchObject({
      ok: false,
      error: { kind: "store_failed" },
    });
  });
});
