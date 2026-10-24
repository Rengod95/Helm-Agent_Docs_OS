// 비투영 테이블 DDL(L1.persistence.spec §3.10). 재생으로 다시 만들 수 없는 테이블이라 투영기 core의 tables에 넣지 않는다.
// 모든 테이블은 STRICT다. 한 번 배포한 문장은 고치지 않고 마이그레이션 단계를 더한다(L0.store.spec §4.6).

export const EVENTS_DDL: readonly string[] = [
  `CREATE TABLE events (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  thread_id      TEXT NOT NULL,
  parent_id      TEXT,
  kind           TEXT NOT NULL,
  version        INTEGER NOT NULL CHECK (version >= 1),
  turn_id        TEXT,
  step_id        TEXT,
  recorded_at    INTEGER NOT NULL,
  request_id     TEXT NOT NULL,
  private_owner  TEXT,
  envelope       TEXT NOT NULL
) STRICT`,
  "CREATE INDEX events_thread_seq ON events (thread_id, seq)",
  "CREATE INDEX events_thread_kind ON events (thread_id, kind, seq)",
  `CREATE TABLE event_seq (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  next_seq       INTEGER NOT NULL
) STRICT`,
  "INSERT INTO event_seq (singleton, next_seq) VALUES (1, 1)",
  "CREATE TABLE thread_delete_guard (thread_id TEXT PRIMARY KEY) STRICT",
  `CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END`,
  `CREATE TRIGGER events_no_delete BEFORE DELETE ON events
WHEN NOT EXISTS (SELECT 1 FROM thread_delete_guard g WHERE g.thread_id = OLD.thread_id)
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END`,
];

export const REQUESTS_DDL: readonly string[] = [
  `CREATE TABLE requests (
  thread_id      TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('committed', 'rejected')),
  result         TEXT NOT NULL,
  first_seq      INTEGER,
  last_seq       INTEGER,
  PRIMARY KEY (thread_id, request_id)
) STRICT`,
];

export const STATE_DDL: readonly string[] = [
  `CREATE TABLE projector_state (
  name           TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  rebuild_cursor TEXT
) STRICT`,
  `CREATE TABLE consumer_cursors (
  consumer       TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT`,
  // 전역 thread 생성 멱등 키(§4.10.1). requests는 thread 범위라 thread 밖 키를 받지 못한다
  `CREATE TABLE thread_creation_keys (
  key            TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL
) STRICT`,
];

/** 스펙 §3.10 표에 적힌 열 목록. ddl.test.ts가 실제 테이블과 대조한다 */
export const SESSION_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  events: [
    "seq",
    "id",
    "thread_id",
    "parent_id",
    "kind",
    "version",
    "turn_id",
    "step_id",
    "recorded_at",
    "request_id",
    "private_owner",
    "envelope",
  ],
  event_seq: ["singleton", "next_seq"],
  thread_delete_guard: ["thread_id"],
  requests: ["thread_id", "request_id", "fingerprint", "status", "result", "first_seq", "last_seq"],
  projector_state: ["name", "version", "last_seq", "rebuild_cursor"],
  consumer_cursors: ["consumer", "seq", "updated_at"],
  thread_creation_keys: ["key", "thread_id"],
};
