import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { attempt, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  dailyId,
  foldTurn,
  HIST_CELLS,
  mergeAggregates,
  type Aggregate,
  type DailyCell,
} from "./turn-fold.ts";
import {
  colNum,
  colNumOrNull,
  colsOf,
  colText,
  colTextOrNull,
  cacheOf,
  callOf,
  dailyOf,
  findingStateOf,
  frameOf,
  hookOf,
  markOf,
  materialOf,
  pluginCallOf,
  skillOf,
  stepOf,
  threadOf,
  toolUseOf,
  TR_CACHE,
  TR_CALL,
  TR_DAILY,
  TR_FINDING_STATE,
  TR_FRAME,
  TR_HOOK,
  TR_MARK,
  TR_MATERIAL,
  TR_PLUGINCALL,
  TR_SKILL,
  TR_STEP,
  TR_THREAD,
  TR_TOOLUSE,
  TR_TURN,
  TURN_CHILD_TABLES,
  TURN_RECORD_DDL,
  TURN_RECORD_VERSION,
  TURN_SUMMARY_COLUMNS,
  turnOf,
  turnSummaryOf,
  type Cols,
  type SqlValue,
  type TableSpec,
  type TrDailyRow,
  type TrFindingStateRow,
  type TrCallRow,
  type TrCacheRow,
  type TrFrameRow,
  type TrHookRow,
  type TrStepRow,
  type TrMarkRow,
  type TrMaterialRow,
  type TrSkillRow,
  type TrStepBatch,
  type TrThreadRow,
  type TrToolUseRow,
  type TrTurnBundle,
  type TrTurnRow,
} from "./turn-tables.ts";

// 측정 저장소(T-MEAS-STORE, 기획서 §8 저장 위치). 대화 DB(`fresnel.db`)와 분리한 측정 전용 SQLite 파일이다. 이벤트 로그의 구조는 바꾸지 않는다.
// 원본 행(`measure_raw`)은 보존 기간(기본 30일)이 지나면 일별 집계(`measure_daily`)로 접고 지운다. 일별 집계는 계속 둔다.
// 턴 기록 테이블(`tr_*`, 문서 `review/m5/turn-record-metrics.md` §3.4)은 같은 파일에 `PRAGMA user_version` 2로 더한다.
// 턴 기록의 보존은 턴 시작 시각 기준이고, 지난 턴의 하위 행은 `tr_daily`로 접은 뒤 지운다(같은 트랜잭션, `prune`).
// 백분위는 SQLite에 함수가 없어 원본 행을 정렬해서 계산한다(`percentile`). 보존 기간을 넘긴 날의 백분위는 집계(개수, 합, 최소, 최대)만 남는다.
// 쓰기는 호출자가 모아서 `writeBatch`(측정 행)나 `writeStep`(턴 기록의 한 단계)으로 한 번에 한다(Turn 경계). 이 파일은 읽기와 쓰기만 하고 켬·끔 판단은 `recorder.ts`가 한다.

/** 원본 보관 기본 일수. 사용자가 설정에서 바꿀 수 있다 [결정: 2026-11-03 사용자] */
export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** 측정 한 건. `metrics`는 이름 → 숫자(토큰, 비용, 시간), `tags`는 이름 → 짧은 문자열(모델, 종료 이유) */
export interface MeasureRecord {
  readonly at: number;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly kind: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly tags: Readonly<Record<string, string>>;
}

/** 일별 집계 한 줄 */
interface DailyAggregate {
  /** UTC 날짜 `YYYY-MM-DD` */
  readonly day: string;
  readonly kind: string;
  readonly metric: string;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}

export type MeasureStoreError =
  | { readonly kind: "io"; readonly cause: unknown }
  | { readonly kind: "closed" }
  /** 턴 기록 테이블을 쓸 수 없다(버전 2 마이그레이션 실패, 더 새로운 버전). `measure_raw`는 그대로 쓴다 */
  | { readonly kind: "turn_record_unavailable" }
  | { readonly kind: "invalid_cursor" }
  /** 저장된 집계 값을 읽을 수 없다 */
  | { readonly kind: "corrupt" };

/** 턴 목록 질의. `cursor`는 `next`로 받은 값이다(행 id 기준, 새 턴이 앞에 와도 쪽 경계가 밀리지 않는다) */
export interface TrTurnQuery {
  readonly threadId: string;
  readonly cursor?: string;
  readonly limit?: number;
  /** 범위 종류 허용 목록. 빈 목록이면 아무것도 내지 않는다 */
  readonly scopes?: readonly string[];
  /** 턴 플래그 비트 마스크. 하나라도 겹치는 턴만 낸다 */
  readonly flagsMask?: number;
}

interface TrTurnListRow extends Omit<TrTurnRow, "recordJson"> {
  /** 행 id. `next` 커서의 원천이다 */
  readonly rowid: number;
}

interface TrTurnPage {
  readonly items: readonly TrTurnListRow[];
  readonly next: string | null;
}

export interface MeasureStore {
  /** 한 묶음을 한 트랜잭션으로 쓴다. 빈 묶음은 아무것도 하지 않는다 */
  writeBatch(records: readonly MeasureRecord[]): Result<number, MeasureStoreError>;
  /**
   * `now` 기준 `retentionDays`보다 오래된 원본을 일별 집계로 접고 지운다. 접기와 지우기는 한 트랜잭션이다. 지운 원본(`measure_raw`) 수를 돌려준다.
   * 턴 기록이 쓸 수 있으면 같은 트랜잭션에서 턴 시작이 `retentionDays`보다 오래된 `tr_*` 턴을 `tr_daily`로 접고 그 턴의 하위 행을 지운다.
   * 일수가 0 이하면 아무것도 지우지 않는다(보관 끔이 아니라 잘못된 값으로 본다)
   */
  prune(now: number, retentionDays: number): Result<number, MeasureStoreError>;
  /** 일별 집계. 이미 접힌 날(`measure_daily`)과 아직 원본이 남은 날을 합쳐 날짜 순으로 낸다 */
  daily(kind: string, metric: string): Result<readonly DailyAggregate[], MeasureStoreError>;
  /** 원본 행에서 계산한 백분위(`p`는 0~1, 가장 가까운 순위). 원본이 없으면 undefined */
  percentile(
    kind: string,
    metric: string,
    p: number,
    since: number,
  ): Result<number | undefined, MeasureStoreError>;
  /** 원본 행 수 */
  rawCount(): Result<number, MeasureStoreError>;
  /**
   * 한 Turn의 원본 행(시간 순). Turn 밖 호출 중 이 Turn 뒤의 것(`afterTurn` 태그)도 호출 행으로 함께 낸다.
   * 이 Turn이 띄운 하위 대화의 호출 행(`ownerThread`·`ownerTurn` 태그)도 합친다. 합친 행은 `viaChild: "1"` 태그가 붙고 `threadId`는 하위 대화다
   * (하위 대화를 따로 읽는 쪽과 같은 행이므로 두 읽기를 더하면 이중 계산이다)
   */
  turn(threadId: string, turnId: string): Result<readonly MeasureRecord[], MeasureStoreError>;
  /** 역할이 `roles`에 드는 호출 행. `threadId`가 없으면 모든 thread다. 사용량 합산이 재시작 뒤에도 배경 호출을 세는 원천이다 */
  callsOfRoles(
    roles: readonly string[],
    threadId: string | undefined,
  ): Result<readonly MeasureRecord[], MeasureStoreError>;
  /** 턴 기록 테이블(`tr_*`)을 쓸 수 있나. 버전 2 마이그레이션이 실패했거나 더 새로운 버전이면 거짓이다 */
  turnRecordAvailable(): boolean;
  /** 설치별 소금(HMAC 키). 첫 열기에 무작위로 만들고 그 뒤로 바꾸지 않는다 */
  installSalt(): Result<string, MeasureStoreError>;
  upsertThread(row: TrThreadRow): Result<number, MeasureStoreError>;
  getThread(threadId: string): Result<TrThreadRow | undefined, MeasureStoreError>;
  /** 테스트 실행 대화(`scope_kind = test`)의 표지. 재시작 뒤 표지를 되살린다 */
  listTestThreads(): Result<readonly TrThreadRow[], MeasureStoreError>;
  /**
   * 한 단계의 기록(단계 행과 그 단계의 하위 행)을 한 트랜잭션으로 쓴다. 같은 키는 덮어쓴다(멱등).
   * 턴 행(`tr_turn`)은 `upsertTurn`이 먼저 있어야 한다(호출자가 지킨다).
   */
  writeStep(batch: TrStepBatch): Result<number, MeasureStoreError>;
  /** 늦은 훅 행만 쓴다(턴을 닫을 때). 이미 쓴 단계의 행은 건드리지 않는다(턴 기록 §7 분리 실행) */
  writeHooks(rows: readonly TrHookRow[]): Result<number, MeasureStoreError>;
  /** 턴 행을 쓴다. 턴 시작 때 `status: "open"`으로, 턴 끝에 최종 값으로 다시 쓴다 */
  upsertTurn(row: TrTurnRow): Result<number, MeasureStoreError>;
  writeFrames(rows: readonly TrFrameRow[]): Result<number, MeasureStoreError>;
  /** 턴 하나와 그 하위 행 전부. 턴이 없으면 undefined */
  readTurn(threadId: string, turnId: string): Result<TrTurnBundle | undefined, MeasureStoreError>;
  /** 턴 목록(최신 순). `recordJson`은 빼고 낸다 */
  listTurns(query: TrTurnQuery): Result<TrTurnPage, MeasureStoreError>;
  /**
   * `open`으로 남은 턴을 `lost`로 바꾸고 `complete`를 거짓으로 둔다(`record_json`의 두 값도 맞춘다).
   * 프로세스가 턴 도중에 죽은 흔적이다. 열기 직후 한 번 부른다. 바꾼 턴 수를 돌려준다
   */
  markLostTurns(): Result<number, MeasureStoreError>;
  /** 대화의 `tr_*` 행을 모두 지운다. `tr_daily`는 대화 단위 값이 없으므로 남는다. 지운 행 수를 돌려준다 */
  forgetThread(threadId: string): Result<number, MeasureStoreError>;
  putMark(row: TrMarkRow): Result<number, MeasureStoreError>;
  getMarks(threadId: string, turnId: string): Result<readonly TrMarkRow[], MeasureStoreError>;
  upsertFindingState(row: TrFindingStateRow): Result<number, MeasureStoreError>;
  getFindingState(findingId: string): Result<TrFindingStateRow | undefined, MeasureStoreError>;
  /** `tr_daily`의 한 주체(`subject`) 행 전부 */
  dailyCounters(subject: string): Result<readonly TrDailyRow[], MeasureStoreError>;
  /**
   * 창 안에서 시작한 원본 턴의 묶음(시작 시각 순). 지표는 이것을 접기 함수로 접고, 근거 참조는 턴 id를 쓴다.
   * 창의 경계는 `[from, to)`다. 보관 기간을 넘은 턴은 없다(접혀서 지워졌다).
   */
  windowBundles(query: WindowQuery): Result<readonly TurnBundleRow[], MeasureStoreError>;
  /**
   * 접힌 날(`tr_daily`)의 카운터. `fromDay`와 `toDay`는 UTC 날짜 `YYYY-MM-DD`이고 양 끝을 포함한다.
   * 원본은 같은 날짜 범위의 원본 턴이 없을 때만 이 값과 겹치지 않는다(호출자가 경계를 나눈다).
   */
  dailyWindow(query: DailyWindowQuery): Result<readonly DailyCell[], MeasureStoreError>;
  /** `tr_turn`의 가장 큰 rowid. 발견 캐시의 `dataRevision`이다. 빈 표면 0 */
  maxTurnRowid(): Result<number, MeasureStoreError>;
  /** 훅 실행 행 검색(`turnRecord.search`). 최신 행부터 `beforeRowid` 아래에서 `limit`개까지 낸다 */
  searchHooks(query: HookSearchQuery): Result<readonly HookSearchRow[], MeasureStoreError>;
  close(): void;
}

/** 원본 턴 창 질의. 시작 시각이 `[from, to)`이고 범위 종류가 `scopes`에 드는 턴 */
interface WindowQuery {
  readonly from: number;
  readonly to: number;
  readonly scopes: readonly string[];
}

/** 접힌 날 질의 */
interface DailyWindowQuery {
  readonly fromDay: string;
  readonly toDay: string;
  readonly scopes: readonly string[];
}

/** 원본 턴 하나와 그 하위 행(창 질의 결과). 하위 행은 모두 이 턴의 것이다 */
export interface TurnBundleRow {
  readonly turn: Omit<TrTurnRow, "recordJson">;
  readonly calls: readonly TrCallRow[];
  readonly hooks: readonly TrHookRow[];
  readonly materials: readonly TrMaterialRow[];
  readonly tooluse: readonly TrToolUseRow[];
  readonly skills: readonly TrSkillRow[];
  readonly steps: readonly TrStepRow[];
  readonly cache: readonly TrCacheRow[];
  readonly frames: readonly TrFrameRow[];
}

/** 훅 검색 질의. `plugin`과 창은 필수, `hook`은 선택이다 */
interface HookSearchQuery {
  readonly plugin: string;
  readonly hook: string | null;
  readonly from: number;
  readonly to: number;
  readonly scopes: readonly string[];
  readonly beforeRowid: number | null;
  readonly limit: number;
}

/** 훅 검색 한 줄. `rowid`는 커서다 */
interface HookSearchRow {
  readonly rowid: number;
  readonly threadId: string;
  readonly turnId: string;
  readonly seqGlobal: number;
  readonly plugin: string;
  readonly hook: string;
  readonly result: string;
  readonly reason: string | null;
  readonly decision: string;
  /** 턴 시작 시각 + 훅 시점(ms) */
  readonly at: number;
}

/** 버전 1 DDL(기존 스키마). 버전 0 파일이 이미 가진 표와 같아서 `IF NOT EXISTS`로 다시 실행해도 안전하다 */
const SCHEMA = `
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

function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** 문자열 하나를 숫자 맵으로 읽는다. 저장소가 쓴 값만 읽으므로 모양이 어긋난 항목은 건너뛴다 */
function numbersOf(source: string): Record<string, number> {
  const read = parseJson(source);
  const out: Record<string, number> = {};
  const parsed = read.ok ? read.value : undefined;
  if (typeof parsed !== "object" || parsed === null) return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

function stringsOf(source: string): Record<string, string> {
  const read = parseJson(source);
  const out: Record<string, string> = {};
  const parsed = read.ok ? read.value : undefined;
  if (typeof parsed !== "object" || parsed === null) return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function userVersionOf(db: Database): number {
  return colNum(colsOf(db.query("PRAGMA user_version").get()), "user_version");
}

/** 턴 기록 버전 2로 올린다. 실패하거나 더 새로운 버전이면 거짓이다(측정 행 쓰기는 그대로 간다) */
function upgradeTurnRecord(db: Database): boolean {
  const upgraded = attempt(() => {
    const version = userVersionOf(db);
    if (version > TURN_RECORD_VERSION) return false;
    if (version < TURN_RECORD_VERSION) {
      db.transaction(() => {
        db.run(TURN_RECORD_DDL);
        db.query("INSERT OR REPLACE INTO tr_meta (key, value) VALUES ('schema', ?)").run(
          String(TURN_RECORD_VERSION),
        );
        db.run(`PRAGMA user_version = ${String(TURN_RECORD_VERSION)}`);
      })();
    }
    // 소금은 있으면 그대로 둔다. 없을 때만 새로 만든다
    db.query("INSERT OR IGNORE INTO tr_meta (key, value) VALUES ('install_salt', ?)").run(
      randomBytes(32).toString("hex"),
    );
    return true;
  });
  return upgraded.ok && upgraded.value;
}

/** 파일 경로(또는 `:memory:`)로 측정 저장소를 연다. 턴 기록 테이블 마이그레이션이 실패해도 열기는 성공한다 */
export function openMeasureStore(path: string): Result<MeasureStore, MeasureStoreError> {
  const opened = attempt(() => new Database(path, { create: true }));
  if (!opened.ok) return err({ kind: "io", cause: opened.error.cause });
  const db = opened.value;
  const base = attempt(() => {
    db.run("PRAGMA journal_mode = WAL");
    db.run(SCHEMA);
    if (userVersionOf(db) < 1) db.run("PRAGMA user_version = 1");
  });
  if (!base.ok) {
    db.close();
    return err({ kind: "io", cause: base.error.cause });
  }
  const turnRecord = upgradeTurnRecord(db);
  let closed = false;

  function run<T>(work: () => T): Result<T, MeasureStoreError> {
    if (closed) return err({ kind: "closed" });
    const result = attempt(work);
    return result.ok ? ok(result.value) : err({ kind: "io", cause: result.error.cause });
  }

  /** 결과를 직접 돌려주는 작업. 작업 안의 예상 가능한 실패는 그대로 나간다 */
  function guarded<T>(work: () => Result<T, MeasureStoreError>): Result<T, MeasureStoreError> {
    if (closed) return err({ kind: "closed" });
    const result = attempt(work);
    if (!result.ok) return err({ kind: "io", cause: result.error.cause });
    return result.value;
  }

  /** 턴 기록 표 전용. 표가 없으면 `turn_record_unavailable`이다 */
  function turnGuarded<T>(work: () => Result<T, MeasureStoreError>): Result<T, MeasureStoreError> {
    if (closed) return err({ kind: "closed" });
    if (!turnRecord) return err({ kind: "turn_record_unavailable" });
    return guarded(work);
  }

  return ok({
    writeBatch: (records) =>
      run(() => {
        if (records.length === 0) return 0;
        const insert = db.prepare(
          "INSERT INTO measure_raw (at, thread_id, turn_id, kind, metrics, tags) VALUES (?, ?, ?, ?, ?, ?)",
        );
        db.transaction(() => {
          for (const record of records) {
            insert.run(
              record.at,
              record.threadId,
              record.turnId,
              record.kind,
              JSON.stringify(record.metrics),
              JSON.stringify(record.tags),
            );
          }
        })();
        return records.length;
      }),
    prune: (now, retentionDays) =>
      guarded(() => {
        if (retentionDays <= 0) return ok(0);
        const cutoff = now - retentionDays * DAY_MS;
        return db.transaction(() => pruneInTransaction(db, cutoff, turnRecord))();
      }),
    daily: (kind, metric) =>
      run(() => {
        const merged = new Map<string, DailyAggregate>();
        for (const row of db
          .query("SELECT day, n, sum, min, max FROM measure_daily WHERE kind = ? AND metric = ?")
          .all(kind, metric)) {
          if (typeof row !== "object" || row === null) continue;
          const day = text("day" in row ? row.day : undefined);
          merged.set(day, {
            day,
            kind,
            metric,
            count: num("n" in row ? row.n : undefined),
            sum: num("sum" in row ? row.sum : undefined),
            min: num("min" in row ? row.min : undefined),
            max: num("max" in row ? row.max : undefined),
          });
        }
        for (const row of db
          .query("SELECT at, metrics FROM measure_raw WHERE kind = ?")
          .all(kind)) {
          if (typeof row !== "object" || row === null) continue;
          const value = numbersOf(text("metrics" in row ? row.metrics : undefined))[metric];
          if (value === undefined) continue;
          const day = dayOf(num("at" in row ? row.at : undefined));
          const known = merged.get(day);
          merged.set(
            day,
            known === undefined
              ? { day, kind, metric, count: 1, sum: value, min: value, max: value }
              : {
                  ...known,
                  count: known.count + 1,
                  sum: known.sum + value,
                  min: Math.min(known.min, value),
                  max: Math.max(known.max, value),
                },
          );
        }
        return [...merged.values()].toSorted((a, b) =>
          a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
        );
      }),
    percentile: (kind, metric, p, since) =>
      run(() => {
        const values: number[] = [];
        for (const row of db
          .query("SELECT metrics FROM measure_raw WHERE kind = ? AND at >= ?")
          .all(kind, since)) {
          if (typeof row !== "object" || row === null) continue;
          const value = numbersOf(text("metrics" in row ? row.metrics : undefined))[metric];
          if (value !== undefined) values.push(value);
        }
        if (values.length === 0) return undefined;
        values.sort((a, b) => a - b);
        const rank = Math.min(values.length - 1, Math.max(0, Math.ceil(p * values.length) - 1));
        return values[rank];
      }),
    rawCount: () =>
      run(() => {
        const row = db.query("SELECT COUNT(*) AS n FROM measure_raw").get();
        return typeof row === "object" && row !== null && "n" in row ? num(row.n) : 0;
      }),
    turn: (threadId, turnId) =>
      run(() => {
        const out: MeasureRecord[] = [];
        for (const row of db
          .query(
            `SELECT at, kind, metrics, tags FROM measure_raw WHERE thread_id = ? AND (turn_id = ?
               OR (turn_id IS NULL AND kind = 'call' AND json_extract(tags, '$.afterTurn') = ?)) ORDER BY id`,
          )
          .all(threadId, turnId, turnId)) {
          if (typeof row !== "object" || row === null) continue;
          out.push({
            at: num("at" in row ? row.at : undefined),
            threadId,
            turnId,
            kind: text("kind" in row ? row.kind : undefined),
            metrics: numbersOf(text("metrics" in row ? row.metrics : undefined)),
            tags: stringsOf(text("tags" in row ? row.tags : undefined)),
          });
        }
        // 이 Turn이 띄운 하위 대화의 모델 호출(탐구 하위 에이전트, 웹 검색)을 합친다
        for (const row of db
          .query(
            `SELECT at, thread_id, turn_id, kind, metrics, tags FROM measure_raw WHERE kind = 'call'
               AND json_extract(tags, '$.ownerThread') = ? AND json_extract(tags, '$.ownerTurn') = ? ORDER BY id`,
          )
          .all(threadId, turnId)) {
          if (typeof row !== "object" || row === null) continue;
          const child = text("thread_id" in row ? row.thread_id : undefined);
          if (child === threadId) continue;
          out.push({
            at: num("at" in row ? row.at : undefined),
            threadId: child,
            turnId: "turn_id" in row && typeof row.turn_id === "string" ? row.turn_id : null,
            kind: "call",
            metrics: numbersOf(text("metrics" in row ? row.metrics : undefined)),
            tags: { ...stringsOf(text("tags" in row ? row.tags : undefined)), viaChild: "1" },
          });
        }
        return out.length === 0 ? out : out.toSorted((a, b) => a.at - b.at);
      }),
    callsOfRoles: (roles, threadId) =>
      run(() => {
        const out: MeasureRecord[] = [];
        if (roles.length === 0) return out;
        const marks = roles.map(() => "?").join(",");
        const rows =
          threadId === undefined
            ? db
                .query(
                  `SELECT at, thread_id, turn_id, kind, metrics, tags FROM measure_raw WHERE kind = 'call' AND json_extract(tags, '$.role') IN (${marks}) ORDER BY id`,
                )
                .all(...roles)
            : db
                .query(
                  `SELECT at, thread_id, turn_id, kind, metrics, tags FROM measure_raw WHERE kind = 'call' AND thread_id = ? AND json_extract(tags, '$.role') IN (${marks}) ORDER BY id`,
                )
                .all(threadId, ...roles);
        for (const row of rows) {
          if (typeof row !== "object" || row === null) continue;
          const turn = "turn_id" in row ? row.turn_id : undefined;
          out.push({
            at: num("at" in row ? row.at : undefined),
            threadId: text("thread_id" in row ? row.thread_id : undefined),
            turnId: typeof turn === "string" ? turn : null,
            kind: "call",
            metrics: numbersOf(text("metrics" in row ? row.metrics : undefined)),
            tags: stringsOf(text("tags" in row ? row.tags : undefined)),
          });
        }
        return out;
      }),
    turnRecordAvailable: () => turnRecord,
    installSalt: () =>
      turnGuarded<string>(() => {
        const salt = colTextOrNull(
          colsOf(db.query("SELECT value FROM tr_meta WHERE key = 'install_salt'").get()),
          "value",
        );
        return salt === null ? err({ kind: "corrupt" }) : ok(salt);
      }),
    upsertThread: (row) => turnGuarded(() => ok(upsertAll(db, TR_THREAD, [row]))),
    getThread: (threadId) =>
      turnGuarded(() =>
        ok(selectAll(db, "SELECT * FROM tr_thread WHERE thread_id = ?", [threadId], threadOf)[0]),
      ),
    listTestThreads: () =>
      turnGuarded(() =>
        ok(
          selectAll(
            db,
            "SELECT * FROM tr_thread WHERE scope_kind = 'test' ORDER BY created_at, thread_id",
            [],
            threadOf,
          ),
        ),
      ),
    writeStep: (batch) =>
      turnGuarded(() =>
        ok(
          db.transaction(
            () =>
              upsertAll(db, TR_STEP, [batch.step]) +
              upsertAll(db, TR_CALL, batch.calls) +
              upsertAll(db, TR_HOOK, batch.hooks) +
              upsertAll(db, TR_MATERIAL, batch.materials) +
              upsertAll(db, TR_TOOLUSE, batch.tooluse) +
              upsertAll(db, TR_SKILL, batch.skills) +
              upsertAll(db, TR_PLUGINCALL, batch.plugincalls) +
              upsertAll(db, TR_CACHE, batch.cache),
          )(),
        ),
      ),
    writeHooks: (rows) =>
      turnGuarded(() => ok(db.transaction(() => upsertAll(db, TR_HOOK, rows))())),
    upsertTurn: (row) => turnGuarded(() => ok(upsertAll(db, TR_TURN, [row]))),
    writeFrames: (rows) =>
      turnGuarded(() => ok(db.transaction(() => upsertAll(db, TR_FRAME, rows))())),
    readTurn: (threadId, turnId) => turnGuarded(() => ok(readBundle(db, threadId, turnId))),
    listTurns: (query) => turnGuarded<TrTurnPage>(() => listTurnRows(db, query)),
    markLostTurns: () => turnGuarded(() => ok(markOpenTurnsLost(db))),
    forgetThread: (threadId) =>
      turnGuarded(() =>
        ok(
          db.transaction(() => {
            let removed = 0;
            for (const table of [...TURN_CHILD_TABLES, "tr_turn", "tr_thread"]) {
              removed += db.query(`DELETE FROM ${table} WHERE thread_id = ?`).run(threadId).changes;
            }
            return removed;
          })(),
        ),
      ),
    putMark: (row) => turnGuarded(() => ok(upsertAll(db, TR_MARK, [row]))),
    getMarks: (threadId, turnId) =>
      turnGuarded(() => ok(turnChildren(db, "tr_mark", threadId, turnId, "rowid", markOf))),
    upsertFindingState: (row) => turnGuarded(() => ok(upsertAll(db, TR_FINDING_STATE, [row]))),
    getFindingState: (findingId) =>
      turnGuarded(() =>
        ok(
          selectAll(
            db,
            "SELECT * FROM tr_finding_state WHERE finding_id = ?",
            [findingId],
            findingStateOf,
          )[0],
        ),
      ),
    dailyCounters: (subject) =>
      turnGuarded(() =>
        ok(
          selectAll(
            db,
            "SELECT * FROM tr_daily WHERE subject = ? ORDER BY day, plugin, ref, model, profile, scope_kind, caller, counter",
            [subject],
            dailyOf,
          ),
        ),
      ),
    windowBundles: (query) => turnGuarded(() => windowBundlesOf(db, query)),
    dailyWindow: (query) => turnGuarded(() => dailyWindowOf(db, query)),
    maxTurnRowid: () => turnGuarded(() => ok(maxTurnRowidOf(db))),
    searchHooks: (query) => turnGuarded(() => searchHooksOf(db, query)),
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  });
}

// ---- 턴 기록 보조 -----------------------------------------------------------

/** 행들을 같은 키로 덮어쓰는 INSERT로 쓴다. 쓴 행 수를 돌려준다 */
function upsertAll<Row>(db: Database, spec: TableSpec<Row>, rows: readonly Row[]): number {
  const statement = db.query(spec.upsert);
  for (const row of rows) statement.run(...spec.bind(row));
  return rows.length;
}

/** 조회 한 번. 열 값을 읽는 함수로 행을 바꾼다 */
function selectAll<T>(
  db: Database,
  sql: string,
  params: readonly SqlValue[],
  read: (cols: Cols) => T,
): readonly T[] {
  return db
    .query(sql)
    .all(...params)
    .map((row) => read(colsOf(row)));
}

function turnChildren<T>(
  db: Database,
  table: string,
  threadId: string,
  turnId: string,
  order: string,
  read: (cols: Cols) => T,
): readonly T[] {
  return selectAll(
    db,
    `SELECT * FROM ${table} WHERE thread_id = ? AND turn_id = ? ORDER BY ${order}`,
    [threadId, turnId],
    read,
  );
}

function readBundle(db: Database, threadId: string, turnId: string): TrTurnBundle | undefined {
  const turn = selectAll(
    db,
    "SELECT * FROM tr_turn WHERE thread_id = ? AND turn_id = ?",
    [threadId, turnId],
    turnOf,
  )[0];
  if (turn === undefined) return undefined;
  return {
    turn,
    steps: turnChildren(db, "tr_step", threadId, turnId, "step_index", stepOf),
    calls: turnChildren(db, "tr_call", threadId, turnId, "rowid", callOf),
    hooks: turnChildren(db, "tr_hook", threadId, turnId, "step_index, seq_global", hookOf),
    materials: turnChildren(db, "tr_material", threadId, turnId, "rowid", materialOf),
    tooluse: turnChildren(db, "tr_tooluse", threadId, turnId, "rowid", toolUseOf),
    skills: turnChildren(db, "tr_skill", threadId, turnId, "rowid", skillOf),
    frames: turnChildren(db, "tr_frame", threadId, turnId, "rowid", frameOf),
    plugincalls: turnChildren(db, "tr_plugincall", threadId, turnId, "seq", pluginCallOf),
    cache: turnChildren(db, "tr_cache", threadId, turnId, "step_index, n", cacheOf),
    marks: turnChildren(db, "tr_mark", threadId, turnId, "rowid", markOf),
  };
}

function listTurnRows(db: Database, query: TrTurnQuery): Result<TrTurnPage, MeasureStoreError> {
  if (query.scopes !== undefined && query.scopes.length === 0) return ok({ items: [], next: null });
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  let before = Number.MAX_SAFE_INTEGER;
  if (query.cursor !== undefined) {
    if (!/^\d+$/.test(query.cursor)) return err({ kind: "invalid_cursor" });
    before = Number(query.cursor);
  }
  const where = ["thread_id = ?", "rowid < ?"];
  const params: SqlValue[] = [query.threadId, before];
  if (query.scopes !== undefined) {
    where.push(`scope_kind IN (${query.scopes.map(() => "?").join(", ")})`);
    params.push(...query.scopes);
  }
  if (query.flagsMask !== undefined && query.flagsMask !== 0) {
    where.push("(flags & ?) <> 0");
    params.push(query.flagsMask);
  }
  params.push(limit + 1);
  const rows = selectAll(
    db,
    `SELECT rowid AS row_id, ${TURN_SUMMARY_COLUMNS} FROM tr_turn WHERE ${where.join(" AND ")} ORDER BY rowid DESC LIMIT ?`,
    params,
    (cols) => ({ rowid: colNum(cols, "row_id"), ...turnSummaryOf(cols) }),
  );
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return ok({ items, next: more && last !== undefined ? String(last.rowid) : null });
}

/** 열 두 칸과 `record_json`의 두 키를 맞춘다. JSON을 읽을 수 없으면 열만 바꾼다 */
function markOpenTurnsLost(db: Database): number {
  const open = selectAll(
    db,
    "SELECT thread_id, turn_id, record_json FROM tr_turn WHERE status = 'open'",
    [],
    (cols) => ({
      threadId: colText(cols, "thread_id"),
      turnId: colText(cols, "turn_id"),
      recordJson: colText(cols, "record_json"),
    }),
  );
  let changed = 0;
  for (const turn of open) {
    const parsed = parseJson(turn.recordJson);
    const value = parsed.ok ? parsed.value : undefined;
    const recordJson =
      typeof value === "object" && value !== null
        ? JSON.stringify({ ...value, status: "lost", complete: false })
        : turn.recordJson;
    db.query(
      "UPDATE tr_turn SET status = 'lost', complete = 0, record_json = ?, record_bytes = ? WHERE thread_id = ? AND turn_id = ?",
    ).run(recordJson, new TextEncoder().encode(recordJson).byteLength, turn.threadId, turn.turnId);
    changed += 1;
  }
  return changed;
}

function keyParams(cell: DailyCell["key"]): SqlValue[] {
  return [
    cell.day,
    cell.subject,
    cell.plugin,
    cell.ref,
    cell.model,
    cell.profile,
    cell.scopeKind,
    cell.caller,
    cell.counter,
  ];
}

/** 저장된 `tr_daily` 한 줄을 집계로 읽는다. 히스토그램이 깨졌으면 `corrupt`다 */
function readDailyAggregate(
  db: Database,
  key: DailyCell["key"],
): Result<Aggregate | undefined, MeasureStoreError> {
  const row = db
    .query(
      "SELECT n, sum, min, max, hist_json FROM tr_daily WHERE day = ? AND subject = ? AND plugin = ? AND ref = ? AND model = ? AND profile = ? AND scope_kind = ? AND caller = ? AND counter = ?",
    )
    .get(...keyParams(key));
  if (row === null) return ok(undefined);
  const cols = colsOf(row);
  const histJson = colTextOrNull(cols, "hist_json");
  let hist: readonly number[] | null = null;
  if (histJson !== null) {
    const parsed = parseJson(histJson);
    const value = parsed.ok ? parsed.value : undefined;
    if (!Array.isArray(value)) return err({ kind: "corrupt" });
    const cells: number[] = [];
    for (const cell of value) {
      if (typeof cell !== "number") return err({ kind: "corrupt" });
      cells.push(cell);
    }
    if (cells.length !== HIST_CELLS) return err({ kind: "corrupt" });
    hist = cells;
  }
  return ok({
    n: colNum(cols, "n"),
    sum: colNum(cols, "sum"),
    min: colNumOrNull(cols, "min"),
    max: colNumOrNull(cols, "max"),
    hist,
  });
}

function dailyRowOf(cell: DailyCell): TrDailyRow {
  return {
    ...cell.key,
    n: cell.agg.n,
    sum: cell.agg.sum,
    min: cell.agg.min,
    max: cell.agg.max,
    histJson: cell.agg.hist === null ? null : JSON.stringify(cell.agg.hist),
  };
}

/**
 * 지난 턴을 접을 카운터를 계산한다. 모두 읽기만 하므로 쓰기 전에 끝난다.
 * 기존 `tr_daily` 값과 합친 최종 값을 돌려준다. 저장값이 깨졌으면 `corrupt`다(아무것도 쓰지 않는다)
 */
function planTurnFolds(
  db: Database,
  turns: readonly { readonly threadId: string; readonly turnId: string }[],
): Result<readonly DailyCell[], MeasureStoreError> {
  const merged = new Map<string, DailyCell>();
  for (const turn of turns) {
    const row = selectAll(
      db,
      "SELECT * FROM tr_turn WHERE thread_id = ? AND turn_id = ?",
      [turn.threadId, turn.turnId],
      turnOf,
    )[0];
    if (row === undefined) continue;
    const folded = foldTurn({
      day: dayOf(row.startedAt),
      turn: row,
      calls: turnChildren(db, "tr_call", turn.threadId, turn.turnId, "rowid", callOf),
      hooks: turnChildren(
        db,
        "tr_hook",
        turn.threadId,
        turn.turnId,
        "step_index, seq_global",
        hookOf,
      ),
      materials: turnChildren(db, "tr_material", turn.threadId, turn.turnId, "rowid", materialOf),
      tooluse: turnChildren(db, "tr_tooluse", turn.threadId, turn.turnId, "rowid", toolUseOf),
      skills: turnChildren(db, "tr_skill", turn.threadId, turn.turnId, "rowid", skillOf),
      steps: turnChildren(db, "tr_step", turn.threadId, turn.turnId, "step_index", stepOf),
      cache: turnChildren(db, "tr_cache", turn.threadId, turn.turnId, "step_index, n", cacheOf),
      frames: turnChildren(db, "tr_frame", turn.threadId, turn.turnId, "rowid", frameOf),
    });
    for (const cell of folded) {
      const id = dailyId(cell.key);
      const prev = merged.get(id);
      merged.set(id, {
        key: cell.key,
        agg: prev === undefined ? cell.agg : mergeAggregates(prev.agg, cell.agg),
      });
    }
  }
  const out: DailyCell[] = [];
  for (const cell of merged.values()) {
    const existing = readDailyAggregate(db, cell.key);
    if (!existing.ok) return err(existing.error);
    out.push({
      key: cell.key,
      agg: existing.value === undefined ? cell.agg : mergeAggregates(existing.value, cell.agg),
    });
  }
  return ok(out);
}

function deleteTurn(db: Database, threadId: string, turnId: string): void {
  for (const table of TURN_CHILD_TABLES) {
    db.query(`DELETE FROM ${table} WHERE thread_id = ? AND turn_id = ?`).run(threadId, turnId);
  }
  db.query("DELETE FROM tr_turn WHERE thread_id = ? AND turn_id = ?").run(threadId, turnId);
}

/** `prune`의 본체. 호출자가 트랜잭션으로 감싼다. 접기 계산이 실패하면 아무것도 쓰지 않는다 */
function pruneInTransaction(
  db: Database,
  cutoff: number,
  turnRecord: boolean,
): Result<number, MeasureStoreError> {
  const old = db.query("SELECT at, kind, metrics FROM measure_raw WHERE at < ?").all(cutoff);
  const oldTurns = turnRecord
    ? selectAll(
        db,
        "SELECT thread_id, turn_id FROM tr_turn WHERE started_at < ?",
        [cutoff],
        (cols) => ({ threadId: colText(cols, "thread_id"), turnId: colText(cols, "turn_id") }),
      )
    : [];
  if (old.length === 0 && oldTurns.length === 0) return ok(0);
  const planned = planTurnFolds(db, oldTurns);
  if (!planned.ok) return err(planned.error);

  const fold = db.prepare(
    `INSERT INTO measure_daily (day, kind, metric, n, sum, min, max) VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(day, kind, metric) DO UPDATE SET
       n = n + 1, sum = sum + excluded.sum, min = MIN(min, excluded.min), max = MAX(max, excluded.max)`,
  );
  for (const row of old) {
    if (typeof row !== "object" || row === null) continue;
    const at = num("at" in row ? row.at : undefined);
    const kind = text("kind" in row ? row.kind : undefined);
    const metrics = numbersOf(text("metrics" in row ? row.metrics : undefined));
    for (const [metric, value] of Object.entries(metrics)) {
      fold.run(dayOf(at), kind, metric, value, value, value);
    }
  }
  db.prepare("DELETE FROM measure_raw WHERE at < ?").run(cutoff);
  upsertAll(db, TR_DAILY, planned.value.map(dailyRowOf));
  for (const turn of oldTurns) deleteTurn(db, turn.threadId, turn.turnId);
  return ok(old.length);
}

// ---- 지표 창 읽기 -----------------------------------------------------------

function marksOf(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** 턴 하나의 키. 같은 턴의 하위 행을 묶을 때 쓴다 */
function turnKeyOf(threadId: string, turnId: string): string {
  return JSON.stringify([threadId, turnId]);
}

function groupByTurn<T extends { readonly threadId: string; readonly turnId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = turnKeyOf(row.threadId, row.turnId);
    const list = out.get(key);
    if (list === undefined) out.set(key, [row]);
    else list.push(row);
  }
  return out;
}

/** 히스토그램 열 한 칸을 읽는다. 칸 수가 다르거나 모양이 깨졌으면 corrupt다 */
function histOf(json: string | null): Result<readonly number[] | null, MeasureStoreError> {
  if (json === null) return ok(null);
  const parsed = parseJson(json);
  const value: unknown = parsed.ok ? parsed.value : undefined;
  if (!Array.isArray(value)) return err({ kind: "corrupt" });
  const cells: number[] = [];
  for (const cell of value) {
    if (typeof cell !== "number") return err({ kind: "corrupt" });
    cells.push(cell);
  }
  if (cells.length !== HIST_CELLS) return err({ kind: "corrupt" });
  return ok(cells);
}

/** `tr_daily` 한 줄을 카운터 묶음으로 바꾼다 */
function cellOfDaily(row: TrDailyRow): Result<DailyCell, MeasureStoreError> {
  const hist = histOf(row.histJson);
  if (!hist.ok) return err(hist.error);
  return ok({
    key: {
      day: row.day,
      subject: row.subject,
      plugin: row.plugin,
      ref: row.ref,
      model: row.model,
      profile: row.profile,
      scopeKind: row.scopeKind,
      caller: row.caller,
      counter: row.counter,
    },
    agg: { n: row.n, sum: row.sum, min: row.min, max: row.max, hist: hist.value },
  });
}

/** 창 안에서 시작한 원본 턴과 하위 행. 시작 시각 순이다 */
function windowBundlesOf(
  db: Database,
  query: WindowQuery,
): Result<readonly TurnBundleRow[], MeasureStoreError> {
  if (query.scopes.length === 0 || query.to <= query.from) return ok([]);
  const where = `started_at >= ? AND started_at < ? AND scope_kind IN (${marksOf(query.scopes.length)})`;
  const params: SqlValue[] = [query.from, query.to, ...query.scopes];
  const turns = selectAll(
    db,
    `SELECT ${TURN_SUMMARY_COLUMNS} FROM tr_turn WHERE ${where} ORDER BY started_at, rowid`,
    params,
    turnSummaryOf,
  );
  const inTurns = `(thread_id, turn_id) IN (SELECT thread_id, turn_id FROM tr_turn WHERE ${where})`;
  const calls = groupByTurn(
    selectAll(db, `SELECT * FROM tr_call WHERE ${inTurns}`, params, callOf),
  );
  const hooks = groupByTurn(
    selectAll(db, `SELECT * FROM tr_hook WHERE ${inTurns}`, params, hookOf),
  );
  const materials = groupByTurn(
    selectAll(db, `SELECT * FROM tr_material WHERE ${inTurns}`, params, materialOf),
  );
  const tooluse = groupByTurn(
    selectAll(db, `SELECT * FROM tr_tooluse WHERE ${inTurns}`, params, toolUseOf),
  );
  const skills = groupByTurn(
    selectAll(db, `SELECT * FROM tr_skill WHERE ${inTurns}`, params, skillOf),
  );
  const steps = groupByTurn(
    selectAll(db, `SELECT * FROM tr_step WHERE ${inTurns}`, params, stepOf),
  );
  const cache = groupByTurn(
    selectAll(db, `SELECT * FROM tr_cache WHERE ${inTurns}`, params, cacheOf),
  );
  const frames = groupByTurn(
    selectAll(db, `SELECT * FROM tr_frame WHERE ${inTurns}`, params, frameOf),
  );
  return ok(
    turns.map((turn) => {
      const key = turnKeyOf(turn.threadId, turn.turnId);
      return {
        turn,
        calls: calls.get(key) ?? [],
        hooks: hooks.get(key) ?? [],
        materials: materials.get(key) ?? [],
        tooluse: tooluse.get(key) ?? [],
        skills: skills.get(key) ?? [],
        steps: steps.get(key) ?? [],
        cache: cache.get(key) ?? [],
        frames: frames.get(key) ?? [],
      };
    }),
  );
}

/** 접힌 날의 카운터. 날짜 범위의 `tr_daily` 행을 묶음으로 바꾼다 */
function dailyWindowOf(
  db: Database,
  query: DailyWindowQuery,
): Result<readonly DailyCell[], MeasureStoreError> {
  if (query.scopes.length === 0 || query.toDay < query.fromDay) return ok([]);
  const rows = selectAll(
    db,
    `SELECT * FROM tr_daily WHERE day >= ? AND day <= ? AND scope_kind IN (${marksOf(query.scopes.length)})`,
    [query.fromDay, query.toDay, ...query.scopes],
    dailyOf,
  );
  const cells: DailyCell[] = [];
  for (const row of rows) {
    const cell = cellOfDaily(row);
    if (!cell.ok) return err(cell.error);
    cells.push(cell.value);
  }
  return ok(cells);
}

function maxTurnRowidOf(db: Database): number {
  return colNum(colsOf(db.query("SELECT COALESCE(MAX(rowid), 0) AS m FROM tr_turn").get()), "m");
}

/** 훅 검색. 턴 시작 시각을 기준으로 창을 거르고 행 id 내림차순으로 쪽을 나눈다 */
function searchHooksOf(
  db: Database,
  query: HookSearchQuery,
): Result<readonly HookSearchRow[], MeasureStoreError> {
  if (query.scopes.length === 0) return ok([]);
  const where = [
    "h.plugin = ?",
    "t.started_at >= ?",
    "t.started_at < ?",
    `t.scope_kind IN (${marksOf(query.scopes.length)})`,
  ];
  const params: SqlValue[] = [query.plugin, query.from, query.to, ...query.scopes];
  if (query.hook !== null) {
    where.push("h.hook = ?");
    params.push(query.hook);
  }
  if (query.beforeRowid !== null) {
    where.push("h.rowid < ?");
    params.push(query.beforeRowid);
  }
  params.push(query.limit);
  const rows = selectAll(
    db,
    `SELECT h.rowid AS row_id, h.thread_id, h.turn_id, h.seq_global, h.plugin, h.hook, h.result, h.reason, h.decision, h.at_ms, t.started_at
       FROM tr_hook h JOIN tr_turn t ON t.thread_id = h.thread_id AND t.turn_id = h.turn_id
       WHERE ${where.join(" AND ")} ORDER BY h.rowid DESC LIMIT ?`,
    params,
    (cols): HookSearchRow => ({
      rowid: colNum(cols, "row_id"),
      threadId: colText(cols, "thread_id"),
      turnId: colText(cols, "turn_id"),
      seqGlobal: colNum(cols, "seq_global"),
      plugin: colText(cols, "plugin"),
      hook: colText(cols, "hook"),
      result: colText(cols, "result"),
      reason: colTextOrNull(cols, "reason"),
      decision: colText(cols, "decision"),
      at: colNum(cols, "started_at") + colNum(cols, "at_ms"),
    }),
  );
  return ok(rows);
}
