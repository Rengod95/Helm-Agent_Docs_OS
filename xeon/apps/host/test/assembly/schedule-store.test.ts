import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createScheduleService,
  EMPTY_STATE,
  type ScheduleDeps,
  type ScheduleService,
  type ScheduleState,
} from "@fresnel/cap-schedule";
import { err, ok } from "@fresnel/contracts";
import { createFileScheduleStore } from "../../src/assembly/schedule-store.ts";
import { openFileLock } from "../fixtures/file-lock.ts";

// 예약 저장소(L4.host-service.spec §4.17). 파일 하나에 상태를 쓰고, 없으면 빈 상태, 손상되면 값으로 실패한다.

const STATE: ScheduleState = {
  version: 2,
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
      trigger: { kind: "repeat", intervalSeconds: 300, maxIterations: 3, expiresAtMs: 9_000_000 },
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

// 호스트 둘은 서로 다른 OS 서비스(= 다른 프로세스와 같은 OS 잠금 경로)를 쓴다
const lockDirs = [
  mkdtempSync(join(tmpdir(), "sch-lock-a-")),
  mkdtempSync(join(tmpdir(), "sch-lock-b-")),
];
const hostA = await openFileLock(lockDirs[0] ?? "");
const hostB = await openFileLock(lockDirs[1] ?? "");
const lock = hostA.fileLock;
afterAll(async () => {
  await hostA.dispose();
  await hostB.dispose();
  for (const lockDir of lockDirs) rmSync(lockDir, { recursive: true, force: true });
});

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
    const store = createFileScheduleStore(dir, lock);
    expect(await store.save(STATE)).toEqual({ ok: true, value: undefined });
    expect(await store.load()).toEqual({ ok: true, value: STATE });
  });

  test("a version 1 file with loop entries is upgraded to repeat on load", async () => {
    mkdirSync(dir, { recursive: true });
    const old = {
      version: 1,
      entries: STATE.entries.map((entry) =>
        entry.trigger.kind === "repeat"
          ? { ...entry, trigger: { ...entry.trigger, kind: "loop" } }
          : entry,
      ),
      runs: STATE.runs,
    };
    writeFileSync(file, JSON.stringify(old));
    const store = createFileScheduleStore(dir, lock);
    expect(await store.load()).toEqual({ ok: true, value: STATE });
  });

  test("a missing file loads as the empty state", async () => {
    const store = createFileScheduleStore(dir, lock);
    expect(await store.load()).toEqual({ ok: true, value: EMPTY_STATE });
  });

  test("a file that is not JSON is a store_failed value, not a throw", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "{ not json");
    const store = createFileScheduleStore(dir, lock);
    expect(await store.load()).toMatchObject({ ok: false, error: { kind: "store_failed" } });
  });

  test("a file with another shape is a store_failed value and names the field", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 3, entries: [], runs: [] }));
    const store = createFileScheduleStore(dir, lock);
    const loaded = await store.load();
    expect(loaded).toMatchObject({ ok: false, error: { kind: "store_failed" } });
    expect(loaded.ok ? "" : loaded.error.message).toContain("/version");
  });

  test("a save leaves only the state file behind and keeps the owner-only modes", async () => {
    const store = createFileScheduleStore(dir, lock);
    await store.save(STATE);
    expect(readdirSync(dir).toSorted()).toEqual(["state.json", "state.json.lock"]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("a second save replaces the first without leaving a temp file", async () => {
    const store = createFileScheduleStore(dir, lock);
    await store.save(STATE);
    await store.save(EMPTY_STATE);
    expect(readdirSync(dir).toSorted()).toEqual(["state.json", "state.json.lock"]);
    expect(await store.load()).toEqual({ ok: true, value: EMPTY_STATE });
  });

  test("a save into a path that cannot be a directory is a store_failed value", async () => {
    writeFileSync(join(root, "blocked"), "");
    const store = createFileScheduleStore(join(root, "blocked", "schedule"), lock);
    expect(await store.save(STATE)).toMatchObject({
      ok: false,
      error: { kind: "store_failed" },
    });
  });
});

// 호스트 둘이 같은 상태 디렉터리를 쓰는 경우(H1-01). 호스트마다 OS 서비스와 예약 엔진을 따로 둔다.
function engineOn(host: typeof hostA, prefix: string): ScheduleService {
  let counter = 0;
  const deps: ScheduleDeps = {
    clock: { now: () => 1_000 },
    store: createFileScheduleStore(dir, host.fileLock),
    runner: { start: () => Promise.resolve(err({ kind: "start_failed", message: "unused" })) },
    ticker: { every: () => () => undefined },
    watcher: { watch: () => () => undefined },
    ids: {
      next: (kind) => {
        counter += 1;
        return `${kind}_${prefix}${String(counter).padStart(4, "0")}`;
      },
    },
  };
  return createScheduleService(deps);
}

function interval(prompt: string) {
  return { trigger: { kind: "interval", everySeconds: 600 }, prompt } as const;
}

async function entriesOnDisk(): Promise<ScheduleState["entries"]> {
  const reader = createFileScheduleStore(dir, lock);
  const loaded = await reader.load();
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value.entries;
}

async function idsOnDisk(): Promise<string[]> {
  return (await entriesOnDisk()).map((entry) => entry.prompt).toSorted();
}

describe("two hosts on one state directory", () => {
  test("an entry one host created survives the other host saving from older memory", async () => {
    const a = engineOn(hostA, "A");
    const b = engineOn(hostB, "B");
    expect((await a.open()).ok).toBe(true);
    expect((await b.open()).ok).toBe(true);
    expect((await b.create(interval("from B"))).ok).toBe(true);
    // A의 메모리는 B의 항목을 모른다. 옛 메모리를 그대로 쓰면 B의 항목이 사라진다
    expect((await a.create(interval("from A"))).ok).toBe(true);
    expect(await idsOnDisk()).toEqual(["from A", "from B"]);
  });

  test("a cancel stops only the cancelled entry and keeps the other host's new entry", async () => {
    const a = engineOn(hostA, "A");
    const b = engineOn(hostB, "B");
    expect((await a.open()).ok).toBe(true);
    const made = await a.create(interval("shared"));
    expect(made.ok).toBe(true);
    expect((await b.open()).ok).toBe(true);
    expect((await b.create(interval("from B"))).ok).toBe(true);
    if (!made.ok) return;
    expect((await a.cancel(made.value.id)).ok).toBe(true);
    const stored = (await entriesOnDisk()).map((entry) => [
      entry.prompt,
      entry.enabled,
      entry.stoppedReason,
    ]);
    expect(stored.toSorted((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ["from B", true, null],
      ["shared", false, "cancelled"],
    ]);
  });

  test("concurrent creates from both hosts all land, and no temp file is left", async () => {
    const a = engineOn(hostA, "A");
    const b = engineOn(hostB, "B");
    expect((await a.open()).ok).toBe(true);
    expect((await b.open()).ok).toBe(true);
    const results = await Promise.all(
      [0, 1, 2, 3, 4].flatMap((n) => [a.create(interval(`a${n}`)), b.create(interval(`b${n}`))]),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await idsOnDisk()).toEqual(["a0", "a1", "a2", "a3", "a4", "b0", "b1", "b2", "b3", "b4"]);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("a failed lock is a store_failed value and writes nothing", async () => {
    const store = createFileScheduleStore(dir, {
      scope: "process",
      withLock: () => Promise.resolve(err({ kind: "timeout", path: file, waitedMs: 5 })),
      updateText: () => Promise.resolve(ok(undefined)),
    });
    expect(await store.save(STATE)).toMatchObject({ ok: false, error: { kind: "store_failed" } });
    expect(readdirSync(dir)).toEqual([]);
  });
});
