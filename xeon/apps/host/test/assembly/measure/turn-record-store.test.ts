import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import {
  openMeasureStore,
  type MeasureStore,
  type TrTurnQuery,
} from "../../../src/assembly/measure/store.ts";
import {
  colNum,
  colsOf,
  colText,
  type TrCacheRow,
  type TrCallRow,
  type TrFrameRow,
  type TrHookRow,
  type TrMaterialRow,
  type TrPluginCallRow,
  type TrSkillRow,
  type TrStepBatch,
  type TrStepRow,
  type TrToolUseRow,
  type TrTurnRow,
} from "../../../src/assembly/measure/turn-tables.ts";

// T-MEAS-STORE: 턴 기록 테이블(`tr_*`, 버전 2). 마이그레이션, 단계 묶음의 멱등 쓰기, 열기 뒤 open 턴의 lost 처리,
// 대화 삭제(tr_daily는 남기고 thread id 문자열은 남기지 않음), 접기 뒤 카운터 값을 본다.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const OLD = NOW - 40 * DAY;
const OLD_DAY = new Date(OLD).toISOString().slice(0, 10);

/** 버전 1 스키마(기존 `store.ts`의 `SCHEMA`와 같은 DDL). 구버전 파일을 만드는 데만 쓴다 */
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS measure_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  kind TEXT NOT NULL,
  metrics TEXT NOT NULL,
  tags TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measure_raw_at ON measure_raw(at);
CREATE INDEX IF NOT EXISTS measure_raw_turn ON measure_raw(thread_id, turn_id);
CREATE INDEX IF NOT EXISTS measure_raw_owner ON measure_raw(json_extract(tags, '$.ownerThread'));
CREATE TABLE IF NOT EXISTS measure_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL,
  sum REAL NOT NULL,
  min REAL NOT NULL,
  max REAL NOT NULL,
  PRIMARY KEY (day, kind, metric)
);
`;

const TR_TABLES = [
  "tr_meta",
  "tr_thread",
  "tr_turn",
  "tr_step",
  "tr_call",
  "tr_hook",
  "tr_material",
  "tr_tooluse",
  "tr_skill",
  "tr_frame",
  "tr_plugincall",
  "tr_cache",
  "tr_daily",
  "tr_mark",
  "tr_finding_state",
];

function withDir<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "turn-record-"));
  try {
    return work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Bug("the measure database must be usable in this test");
  return result.value;
}

function memoryStore(): MeasureStore {
  return must(openMeasureStore(":memory:"));
}

function hist(counts: Record<number, number>): number[] {
  return Array.from({ length: 20 }, (_, index) => counts[index] ?? 0);
}

function turnOf(
  threadId: string,
  turnId: string,
  startedAt: number,
  extra: Partial<TrTurnRow> = {},
): TrTurnRow {
  return {
    threadId,
    turnId,
    startedAt,
    endedAt: null,
    status: "open",
    origin: "user",
    scopeKind: "live",
    profileId: "prof-1",
    profileRev: 1,
    profileRevChangesJson: null,
    overlayJson: null,
    pluginStderrJson: null,
    level: "full",
    complete: false,
    model: "m-1",
    flags: 0,
    recordJson: JSON.stringify({ schema: 1, status: "open", complete: false }),
    recordBytes: 0,
    startedEventId: null,
    ...extra,
  };
}

function stepOf(threadId: string, turnId: string, stepIndex: number): TrStepRow {
  return {
    threadId,
    turnId,
    stepIndex,
    model: "m-1",
    input: 100,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    retries: 0,
    advCount: 1,
    advTokens: 40,
    deferredCount: 0,
    toolsetFp: null,
    materialsFp: null,
    recorded: true,
  };
}

function callOf(
  threadId: string,
  turnId: string,
  id: string,
  extra: Partial<TrCallRow> = {},
): TrCallRow {
  return {
    threadId,
    turnId,
    toolCallId: id,
    stepIndex: 0,
    tool: "bash",
    plugin: "core",
    caller: "main",
    callerPlugin: null,
    via: null,
    inheritedFrom: null,
    verdict: "allowed",
    blockedPlugin: null,
    blockedHook: null,
    callKey: "callkey-1",
    targetKey: null,
    execMs: 5,
    execStatus: "ok",
    resultTokens: 3,
    resultTruncated: false,
    resultItemId: null,
    metaJson: "{}",
    ...extra,
  };
}

function hookOf(
  threadId: string,
  turnId: string,
  seq: number,
  extra: Partial<TrHookRow> = {},
): TrHookRow {
  return {
    threadId,
    turnId,
    stepIndex: 0,
    seqGlobal: seq,
    hook: "tool.call.before",
    registrationId: "reg-1",
    plugin: "core",
    versionId: null,
    toolCallId: null,
    subjectJson: "{}",
    decision: "none",
    result: "passed",
    reason: null,
    askVia: null,
    askWaits: null,
    askMs: null,
    askAnswer: null,
    ms: 1,
    atMs: 0,
    size: 0,
    skippedBy: null,
    decisionText: null,
    ...extra,
  };
}

function materialOf(
  threadId: string,
  turnId: string,
  stepIndex: number,
  ref: string,
  plugin: string,
  kind: string,
  tokens: number,
): TrMaterialRow {
  return {
    threadId,
    turnId,
    stepIndex,
    ref,
    plugin,
    kind,
    material: "instruction",
    tokens,
    truncated: false,
    omitted: null,
    itemId: null,
    attribution: "declared",
  };
}

function toolOf(
  threadId: string,
  turnId: string,
  tool: string,
  plugin: string,
  tokens: number,
  state: string,
  called: number,
): TrToolUseRow {
  return { threadId, turnId, tool, plugin, tokens, state, called };
}

function skillOf(
  threadId: string,
  turnId: string,
  skill: string,
  listed: boolean,
  read: boolean,
  tokens: number | null,
): TrSkillRow {
  return {
    threadId,
    turnId,
    skill,
    plugin: "ext",
    listed,
    read,
    via: read ? "model" : null,
    stepIndex: 0,
    tokens,
  };
}

/** 한 단계에 모든 종류의 하위 행을 하나씩 담은 묶음 */
function fullStep(threadId: string, turnId: string, stepIndex: number): TrStepBatch {
  const plugincall: TrPluginCallRow = {
    threadId,
    turnId,
    seq: stepIndex + 1,
    plugin: "core",
    capability: "cap.x",
    method: "run",
    requestKey: "rk-1",
    ok: true,
    ms: 2,
    via: "tool",
    toolCallId: null,
  };
  const cache: TrCacheRow = {
    threadId,
    turnId,
    stepIndex,
    n: 1,
    observed: true,
    kind: "prefix_reset",
    plugin: "core",
    registrations: "[]",
    evidence: "declared",
    cacheRead: 0,
    cacheWrite: 1200,
    priorCacheRead: null,
    priorCacheWrite: null,
  };
  return {
    step: stepOf(threadId, turnId, stepIndex),
    calls: [callOf(threadId, turnId, `call-${turnId}-${stepIndex}`, { stepIndex })],
    hooks: [hookOf(threadId, turnId, 1, { stepIndex, toolCallId: `call-${turnId}-${stepIndex}` })],
    materials: [materialOf(threadId, turnId, stepIndex, "r-core", "core", "always", 10)],
    tooluse: [toolOf(threadId, turnId, "bash", "core", 40, "advertised", 1)],
    skills: [skillOf(threadId, turnId, "skill-x", true, false, null)],
    plugincalls: [plugincall],
    cache: [cache],
  };
}

function frameOf(threadId: string, turnId: string): TrFrameRow {
  return {
    threadId,
    turnId,
    leaseId: "lease-1",
    depth: 0,
    plugin: "core",
    versionId: "sha256:abc",
    parentLeaseId: null,
    enteredAtMs: 0,
    exitedAtMs: null,
    exitReason: null,
    lowerResumedWith: null,
    limitsJson: "{}",
    usedJson: "{}",
    userMessages: 0,
  };
}

function rawCount(path: string, table: string, threadId: string): number {
  const raw = new Database(path);
  try {
    return colNum(
      colsOf(raw.query(`SELECT COUNT(*) AS n FROM ${table} WHERE thread_id = ?`).get(threadId)),
      "n",
    );
  } finally {
    raw.close();
  }
}

function summaryOf(
  rows: readonly {
    plugin: string;
    ref: string;
    caller: string;
    counter: string;
    n: number;
    sum: number;
  }[],
): string[] {
  return rows.map(
    (row) => `${row.plugin}/${row.ref}/${row.caller}/${row.counter} n=${row.n} sum=${row.sum}`,
  );
}

test("a new database opens at user_version 2 with the turn-record tables and keeps its install salt", () => {
  withDir((dir) => {
    const path = join(dir, "measure.db");
    const store = must(openMeasureStore(path));
    expect(store.turnRecordAvailable()).toBe(true);
    const salt = must(store.installSalt());
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    store.close();

    const again = must(openMeasureStore(path));
    expect(must(again.installSalt())).toBe(salt);
    again.close();

    const raw = new Database(path);
    expect(colNum(colsOf(raw.query("PRAGMA user_version").get()), "user_version")).toBe(2);
    const tables = raw
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tr_%' ORDER BY name",
      )
      .all()
      .map((row) => colText(colsOf(row), "name"));
    expect(tables).toEqual(TR_TABLES.toSorted());
    raw.close();
  });
});

for (const version of [0, 1]) {
  test(`a database at user_version ${String(version)} with the old tables keeps its data through the migration`, () => {
    withDir((dir) => {
      const path = join(dir, "measure.db");
      const legacy = new Database(path);
      legacy.run("PRAGMA journal_mode = WAL");
      legacy.run(LEGACY_SCHEMA);
      const insert = legacy.query(
        "INSERT INTO measure_raw (at, thread_id, turn_id, kind, metrics, tags) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insert.run(NOW - DAY, "thr_old", "trn_old", "turn", '{"totalTokens":120}', "{}");
      insert.run(NOW - 2 * DAY, "thr_old", "trn_old2", "turn", '{"totalTokens":80}', "{}");
      legacy.run(`PRAGMA user_version = ${String(version)}`);
      legacy.close();

      const store = must(openMeasureStore(path));
      expect(store.turnRecordAvailable()).toBe(true);
      expect(store.rawCount()).toEqual({ ok: true, value: 2 });
      expect(store.turn("thr_old", "trn_old")).toEqual({
        ok: true,
        value: [
          {
            at: NOW - DAY,
            threadId: "thr_old",
            turnId: "trn_old",
            kind: "turn",
            metrics: { totalTokens: 120 },
            tags: {},
          },
        ],
      });
      const upgraded = must(store.upsertTurn(turnOf("thr_old", "trn_new", NOW)));
      expect(upgraded).toBe(1);
      store.close();

      const raw = new Database(path);
      expect(colNum(colsOf(raw.query("PRAGMA user_version").get()), "user_version")).toBe(2);
      expect(colNum(colsOf(raw.query("SELECT COUNT(*) AS n FROM measure_raw").get()), "n")).toBe(2);
      raw.close();
    });
  });
}

test("a migration that fails leaves the measure rows writable and reports the turn record as unavailable", () => {
  withDir((dir) => {
    const path = join(dir, "measure.db");
    // 버전 2의 인덱스 `tr_call_plugin_verdict`가 이 표의 열을 찾지 못해 마이그레이션이 실패한다
    const broken = new Database(path);
    broken.run("CREATE TABLE tr_call (x INTEGER)");
    broken.close();

    const store = must(openMeasureStore(path));
    expect(store.turnRecordAvailable()).toBe(false);
    expect(store.installSalt()).toEqual({ ok: false, error: { kind: "turn_record_unavailable" } });
    expect(store.upsertTurn(turnOf("thr_x", "trn_x", NOW))).toEqual({
      ok: false,
      error: { kind: "turn_record_unavailable" },
    });
    expect(
      store.writeBatch([
        {
          at: NOW,
          threadId: "thr_x",
          turnId: "trn_x",
          kind: "turn",
          metrics: { usd: 1 },
          tags: {},
        },
      ]),
    ).toEqual({ ok: true, value: 1 });
    expect(store.rawCount()).toEqual({ ok: true, value: 1 });
    store.close();

    const raw = new Database(path);
    expect(colNum(colsOf(raw.query("PRAGMA user_version").get()), "user_version")).toBe(1);
    const names = raw
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tr_meta'")
      .all();
    expect(names).toEqual([]);
    raw.close();
  });
});

test("writing the same step twice is idempotent and a later write replaces the same keys", () => {
  const store = memoryStore();
  must(store.upsertTurn(turnOf("thr_a", "trn_1", NOW)));
  const batch = fullStep("thr_a", "trn_1", 0);
  expect(store.writeStep(batch)).toEqual({ ok: true, value: 8 });
  expect(store.writeStep(batch)).toEqual({ ok: true, value: 8 });

  const once = must(store.readTurn("thr_a", "trn_1"));
  if (once === undefined) throw new Bug("the turn written above must be readable");
  expect(once.steps).toHaveLength(1);
  expect(once.calls).toHaveLength(1);
  expect(once.hooks).toHaveLength(1);
  expect(once.materials).toHaveLength(1);
  expect(once.tooluse).toHaveLength(1);
  expect(once.skills).toHaveLength(1);
  expect(once.plugincalls).toHaveLength(1);
  expect(once.cache).toHaveLength(1);

  const changed = {
    ...batch,
    calls: [
      callOf("thr_a", "trn_1", batch.calls[0]?.toolCallId ?? "", {
        verdict: "blocked_hook",
        execMs: null,
      }),
    ],
  };
  must(store.writeStep(changed));
  const after = must(store.readTurn("thr_a", "trn_1"));
  expect(after?.calls.map((call) => [call.verdict, call.execMs])).toEqual([["blocked_hook", null]]);
  expect(after?.calls).toHaveLength(1);
  store.close();
});

test("a turn left open by a dead process reads as lost after reopening, and its finished steps stay", () => {
  withDir((dir) => {
    const path = join(dir, "measure.db");
    const first = must(openMeasureStore(path));
    must(first.upsertTurn(turnOf("thr_d", "trn_stepped", NOW)));
    must(first.writeStep(fullStep("thr_d", "trn_stepped", 0)));
    must(first.upsertTurn(turnOf("thr_d", "trn_empty", NOW + 1)));
    must(
      first.upsertTurn(
        turnOf("thr_d", "trn_done", NOW + 2, { status: "completed", complete: true }),
      ),
    );
    // 프로세스가 죽는다: 정상 종료 없이 닫는다
    first.close();

    const reopened = must(openMeasureStore(path));
    expect(must(reopened.markLostTurns())).toBe(2);
    expect(must(reopened.markLostTurns())).toBe(0);

    const stepped = must(reopened.readTurn("thr_d", "trn_stepped"));
    expect(stepped?.turn.status).toBe("lost");
    expect(stepped?.turn.complete).toBe(false);
    expect(JSON.parse(stepped?.turn.recordJson ?? "null")).toMatchObject({
      status: "lost",
      complete: false,
    });
    expect(stepped?.steps).toHaveLength(1);

    expect(must(reopened.readTurn("thr_d", "trn_empty"))?.turn.status).toBe("lost");
    expect(must(reopened.readTurn("thr_d", "trn_done"))?.turn.status).toBe("completed");
    expect(must(reopened.readTurn("thr_d", "trn_done"))?.turn.complete).toBe(true);
    reopened.close();
  });
});

test("forgetting a thread deletes its tr_ rows, keeps tr_daily, and no daily row holds the thread id", () => {
  withDir((dir) => {
    const path = join(dir, "measure.db");
    const threadId = "thr_secret_42";
    const store = must(openMeasureStore(path));
    must(
      store.upsertThread({
        threadId,
        scopeKind: "test",
        testBaseProfile: "base",
        testTarget: "plugin-a",
        runGroupId: "grp-1",
        inputHash: "hash-1",
        createdAt: OLD,
        draftJson: null,
      }),
    );

    // 오래된 턴은 접혀서 tr_daily에 남아야 한다
    must(store.upsertTurn(turnOf(threadId, "trn_old", OLD)));
    must(store.writeStep(fullStep(threadId, "trn_old", 0)));
    must(
      store.upsertTurn(turnOf(threadId, "trn_old", OLD, { status: "completed", complete: true })),
    );
    must(store.prune(NOW, 30));
    const foldedBefore = must(store.dailyCounters("turn"));
    expect(foldedBefore.map((row) => row.scopeKind)).toEqual(["live"]);

    // 아직 보존 안의 턴은 모든 표에 행을 가진다
    const recent = NOW - 60_000;
    must(store.upsertTurn(turnOf(threadId, "trn_new", recent)));
    must(store.writeStep(fullStep(threadId, "trn_new", 0)));
    must(store.writeStep(fullStep(threadId, "trn_new", 1)));
    must(store.writeFrames([frameOf(threadId, "trn_new")]));
    must(
      store.putMark({
        threadId,
        turnId: "trn_new",
        ref: "r-core",
        mark: "followed",
        plugin: "core",
        markedAt: recent,
      }),
    );
    expect(must(store.readTurn(threadId, "trn_new"))?.frames).toHaveLength(1);
    expect(must(store.getThread(threadId))?.testBaseProfile).toBe("base");
    store.close();

    const otherThread = must(openMeasureStore(path));
    must(otherThread.upsertTurn(turnOf("thr_keep", "trn_keep", recent)));
    must(otherThread.writeStep(fullStep("thr_keep", "trn_keep", 0)));
    otherThread.close();

    const forgetting = must(openMeasureStore(path));
    const dailyRowsBefore = must(forgetting.dailyCounters("turn")).length;
    expect(must(forgetting.forgetThread(threadId))).toBeGreaterThan(0);
    expect(must(forgetting.readTurn(threadId, "trn_new"))).toBeUndefined();
    expect(must(forgetting.readTurn(threadId, "trn_old"))).toBeUndefined();
    expect(must(forgetting.getThread(threadId))).toBeUndefined();
    expect(must(forgetting.getMarks(threadId, "trn_new"))).toEqual([]);
    expect(must(forgetting.readTurn("thr_keep", "trn_keep"))?.steps).toHaveLength(1);
    expect(must(forgetting.dailyCounters("turn"))).toHaveLength(dailyRowsBefore);
    forgetting.close();

    for (const table of [
      "tr_thread",
      "tr_turn",
      "tr_step",
      "tr_call",
      "tr_hook",
      "tr_material",
      "tr_tooluse",
      "tr_skill",
      "tr_frame",
      "tr_plugincall",
      "tr_cache",
      "tr_mark",
    ]) {
      expect(rawCount(path, table, threadId)).toBe(0);
    }

    const raw = new Database(path);
    const daily = JSON.stringify(raw.query("SELECT * FROM tr_daily").all());
    raw.close();
    // 접힌 값은 남고, 열 어디에도 대화 id나 턴 id 문자열이 없다
    expect(daily).toContain('"turns"');
    expect(daily).not.toContain(threadId);
    expect(daily).not.toContain("trn_old");
  });
});

test("folding an old turn writes the counters and removes the turn rows", () => {
  const store = memoryStore();
  const threadId = "thr_fold";
  const turnId = "trn_fold";
  must(store.upsertTurn(turnOf(threadId, turnId, OLD, { status: "completed", complete: true })));
  must(
    store.writeStep({
      step: stepOf(threadId, turnId, 0),
      calls: [
        callOf(threadId, turnId, "call_1", {
          tool: "bash",
          plugin: "core",
          caller: "main",
          verdict: "allowed",
          execMs: 5,
        }),
        callOf(threadId, turnId, "call_2", {
          tool: "bash",
          plugin: "core",
          caller: "main",
          verdict: "blocked_hook",
          execMs: null,
        }),
        callOf(threadId, turnId, "call_3", {
          tool: "write",
          plugin: "ext",
          caller: "subagent",
          verdict: "allowed",
          execMs: 20,
        }),
      ],
      hooks: [
        hookOf(threadId, turnId, 1, {
          toolCallId: "call_2",
          result: "blocked",
          decision: "block",
          ms: 3,
        }),
        hookOf(threadId, turnId, 2, {
          toolCallId: "call_1",
          result: "failed",
          reason: "timeout",
          ms: 2000,
        }),
        hookOf(threadId, turnId, 3, {
          plugin: "ext",
          hook: "tool.result",
          toolCallId: "call_3",
          result: "modified",
          ms: 1,
          decision: "ask",
          askVia: "decision",
          askAnswer: "allow",
        }),
      ],
      materials: [
        materialOf(threadId, turnId, 0, "r-core", "core", "always", 10),
        materialOf(threadId, turnId, 0, "r-ext-drive", "ext", "drive", 7),
        materialOf(threadId, turnId, 0, "skill-x", "ext", "on_demand", 5),
      ],
      tooluse: [
        toolOf(threadId, turnId, "bash", "core", 40, "advertised", 2),
        toolOf(threadId, turnId, "write", "ext", 30, "activated", 1),
        toolOf(threadId, turnId, "lazy", "ext", 99, "deferred", 0),
      ],
      skills: [
        skillOf(threadId, turnId, "skill-x", true, true, 5),
        skillOf(threadId, turnId, "skill-y", true, false, null),
      ],
      plugincalls: [],
      cache: [],
    }),
  );
  // 같은 재료가 다음 단계에도 있으면 마지막 단계 값만 센다
  must(
    store.writeStep({
      step: stepOf(threadId, turnId, 1),
      calls: [],
      hooks: [],
      materials: [materialOf(threadId, turnId, 1, "r-core", "core", "always", 12)],
      tooluse: [],
      skills: [],
      plugincalls: [],
      cache: [],
    }),
  );

  expect(must(store.prune(NOW, 30))).toBe(0);
  expect(must(store.readTurn(threadId, turnId))).toBeUndefined();

  expect(
    must(store.dailyCounters("turn")).map((row) => [
      row.day,
      row.model,
      row.profile,
      row.scopeKind,
      row.counter,
      row.n,
    ]),
  ).toEqual([[OLD_DAY, "m-1", "prof-1", "live", "turns", 1]]);

  const hooks = must(store.dailyCounters("hook"));
  expect(summaryOf(hooks)).toEqual([
    "core/tool.call.before/main/blocked n=1 sum=3",
    "core/tool.call.before/main/failed n=1 sum=2000",
    "core/tool.call.before/main/reason:timeout n=1 sum=0",
    "ext/tool.result/subagent/ask:allow n=1 sum=0",
    "ext/tool.result/subagent/modified n=1 sum=1",
  ]);
  expect(hooks[0]?.histJson).toBe(JSON.stringify(hist({ 2: 1 })));
  expect(hooks[1]?.histJson).toBe(JSON.stringify(hist({ 11: 1 })));

  const calls = must(store.dailyCounters("call"));
  expect(summaryOf(calls)).toEqual([
    "core/bash/main/allowed n=1 sum=5",
    "core/bash/main/blocked_hook n=1 sum=0",
    "ext/write/subagent/allowed n=1 sum=20",
  ]);
  expect(calls[0]?.histJson).toBe(JSON.stringify(hist({ 3: 1 })));
  expect(calls[1]?.histJson).toBe(JSON.stringify(hist({})));

  expect(summaryOf(must(store.dailyCounters("tool")))).toEqual([
    "core/bash//advertised_turns n=1 sum=40",
    "core/bash//called n=1 sum=0",
    "ext/lazy//deferred_turns n=1 sum=0",
    "ext/write//advertised_turns n=1 sum=30",
    "ext/write//called n=1 sum=0",
  ]);
  expect(summaryOf(must(store.dailyCounters("skill")))).toEqual([
    "ext/skill-x//listed_turns n=1 sum=0",
    "ext/skill-x//read_turns n=1 sum=5",
    "ext/skill-y//listed_turns n=1 sum=0",
  ]);
  // 비용: 핵심 플러그인은 재료 12(마지막 단계) + 광고 도구 40 = 52, 확장 플러그인은 드라이브 7, 필요할 때 5 + 35
  const cost = must(store.dailyCounters("cost"));
  expect(summaryOf(cost)).toEqual([
    "core///always n=1 sum=52",
    "ext///drive n=1 sum=7",
    "ext///on_demand n=1 sum=35",
  ]);
  expect(cost[0]?.histJson).toBe(JSON.stringify(hist({ 6: 1 })));
  expect(cost[1]?.histJson).toBe(JSON.stringify(hist({ 3: 1 })));
  store.close();
});

test("listing turns pages newest first with a row-id cursor and applies the scope and flag filters", () => {
  const store = memoryStore();
  const threadId = "thr_list";
  for (let index = 0; index < 5; index += 1) {
    must(
      store.upsertTurn(
        turnOf(threadId, `trn_${String(index)}`, NOW + index, {
          scopeKind: index >= 3 ? "test" : "live",
          flags: index,
        }),
      ),
    );
  }
  const ids = (query: TrTurnQuery): string[] =>
    must(store.listTurns(query)).items.map((item) => item.turnId);

  const first = must(store.listTurns({ threadId, limit: 2 }));
  expect(first.items.map((item) => item.turnId)).toEqual(["trn_4", "trn_3"]);
  expect(first.next).not.toBeNull();
  const second = must(
    store.listTurns({ threadId, limit: 2, ...(first.next === null ? {} : { cursor: first.next }) }),
  );
  expect(second.items.map((item) => item.turnId)).toEqual(["trn_2", "trn_1"]);
  const third = must(
    store.listTurns({
      threadId,
      limit: 2,
      ...(second.next === null ? {} : { cursor: second.next }),
    }),
  );
  expect(third.items.map((item) => item.turnId)).toEqual(["trn_0"]);
  expect(third.next).toBeNull();

  expect(ids({ threadId, scopes: ["test"] })).toEqual(["trn_4", "trn_3"]);
  expect(ids({ threadId, scopes: [] })).toEqual([]);
  expect(ids({ threadId, flagsMask: 2 })).toEqual(["trn_3", "trn_2"]);
  expect(store.listTurns({ threadId, cursor: "abc" })).toEqual({
    ok: false,
    error: { kind: "invalid_cursor" },
  });
  // 목록은 record_json을 싣지 않는다
  expect(first.items[0] && "recordJson" in first.items[0]).toBe(false);
  store.close();
});

test("threads, marks and finding state round-trip through their own rows", () => {
  const store = memoryStore();
  must(
    store.upsertThread({
      threadId: "thr_t1",
      scopeKind: "test",
      testBaseProfile: "base",
      testTarget: "p",
      runGroupId: "g1",
      inputHash: "h1",
      createdAt: NOW,
      draftJson: "{}",
    }),
  );
  must(
    store.upsertThread({
      threadId: "thr_t2",
      scopeKind: "live",
      testBaseProfile: null,
      testTarget: null,
      runGroupId: null,
      inputHash: null,
      createdAt: NOW,
      draftJson: null,
    }),
  );
  expect(must(store.listTestThreads()).map((row) => row.threadId)).toEqual(["thr_t1"]);

  must(
    store.putMark({
      threadId: "thr_t1",
      turnId: "trn_1",
      ref: "r1",
      mark: "followed",
      plugin: "core",
      markedAt: NOW,
    }),
  );
  must(
    store.putMark({
      threadId: "thr_t1",
      turnId: "trn_1",
      ref: "r1",
      mark: "not_followed",
      plugin: "core",
      markedAt: NOW + 1,
    }),
  );
  expect(must(store.getMarks("thr_t1", "trn_1"))).toEqual([
    {
      threadId: "thr_t1",
      turnId: "trn_1",
      ref: "r1",
      mark: "not_followed",
      plugin: "core",
      markedAt: NOW + 1,
    },
  ]);

  must(
    store.upsertFindingState({
      findingId: "f1",
      state: "dismissed",
      dismissedAt: NOW,
      snoozeUntil: null,
      fingerprint: "fp",
    }),
  );
  expect(must(store.getFindingState("f1"))?.state).toBe("dismissed");
  expect(must(store.getFindingState("missing"))).toBeUndefined();
  store.close();
});

test("a write after close is a closed error value on the turn-record methods too", () => {
  const store = memoryStore();
  store.close();
  expect(store.upsertTurn(turnOf("thr_c", "trn_c", NOW))).toEqual({
    ok: false,
    error: { kind: "closed" },
  });
  expect(store.readTurn("thr_c", "trn_c")).toEqual({ ok: false, error: { kind: "closed" } });
});
