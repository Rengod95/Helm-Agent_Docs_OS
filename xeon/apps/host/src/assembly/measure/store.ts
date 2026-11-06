import { Database } from "bun:sqlite";
import { attempt, err, ok, parseJson, type Result } from "@fresnel/contracts";

// 측정 저장소(T-MEAS-STORE, 기획서 §8 저장 위치). 대화 DB(`fresnel.db`)와 분리한 측정 전용 SQLite 파일이다. 이벤트 로그의 구조는 바꾸지 않는다.
// 원본 행(`measure_raw`)은 보존 기간(기본 30일)이 지나면 일별 집계(`measure_daily`)로 접고 지운다. 일별 집계는 계속 둔다.
// 백분위는 SQLite에 함수가 없어 원본 행을 정렬해서 계산한다(`percentile`). 보존 기간을 넘긴 날의 백분위는 집계(개수, 합, 최소, 최대)만 남는다.
// 쓰기는 호출자가 모아서 `writeBatch`로 한 번에 한다(Turn 경계). 이 파일은 읽기와 쓰기만 하고 켬·끔 판단은 `recorder.ts`가 한다.

/** 원본 보관 기본 일수. 사용자가 설정에서 바꿀 수 있다 [결정: 2026-11-03 사용자] */
export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

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
  | { readonly kind: "closed" };

export interface MeasureStore {
  /** 한 묶음을 한 트랜잭션으로 쓴다. 빈 묶음은 아무것도 하지 않는다 */
  writeBatch(records: readonly MeasureRecord[]): Result<number, MeasureStoreError>;
  /**
   * `now` 기준 `retentionDays`보다 오래된 원본을 일별 집계로 접고 지운다. 접기와 지우기는 한 트랜잭션이다. 지운 원본 수를 돌려준다.
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
  close(): void;
}

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

/** 파일 경로(또는 `:memory:`)로 측정 저장소를 연다 */
export function openMeasureStore(path: string): Result<MeasureStore, MeasureStoreError> {
  const opened = attempt(() => {
    const db = new Database(path, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run(SCHEMA);
    return db;
  });
  if (!opened.ok) return err({ kind: "io", cause: opened.error.cause });
  const db = opened.value;
  let closed = false;

  function run<T>(work: () => T): Result<T, MeasureStoreError> {
    if (closed) return err({ kind: "closed" });
    const result = attempt(work);
    return result.ok ? ok(result.value) : err({ kind: "io", cause: result.error.cause });
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
      run(() => {
        if (retentionDays <= 0) return 0;
        const cutoff = now - retentionDays * DAY_MS;
        const old = db.query("SELECT at, kind, metrics FROM measure_raw WHERE at < ?").all(cutoff);
        if (old.length === 0) return 0;
        const fold = db.prepare(
          `INSERT INTO measure_daily (day, kind, metric, n, sum, min, max) VALUES (?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(day, kind, metric) DO UPDATE SET
             n = n + 1, sum = sum + excluded.sum, min = MIN(min, excluded.min), max = MAX(max, excluded.max)`,
        );
        db.transaction(() => {
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
        })();
        return old.length;
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
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  });
}
