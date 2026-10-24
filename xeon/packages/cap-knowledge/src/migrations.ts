import type { MigrationSet } from "@xeon/contracts/records";

// L2.knowledge.spec §3.8 세션 밖 상태 테이블. 소유자 `cap.knowledge`, 테이블 접두 `cap_knowledge_`(F owners.ts).
// 마이그레이션은 작업마다 단계를 더한다. 1단계(KN.1)는 파일 상태, 스킬 색인, 원장이다. 제안 대기열(KN.2)과 문서 FTS(KN.4)는
// 그 작업이 2단계 이후로 더한다(체크섬이 적용된 단계를 바꾸지 못하게 한다).

export const KNOWLEDGE_OWNER = "cap.knowledge";

export const KNOWLEDGE_MIGRATIONS: MigrationSet = {
  owner: KNOWLEDGE_OWNER,
  version: 1,
  steps: [
    {
      version: 1,
      sql: [
        `CREATE TABLE cap_knowledge_files (
  path        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('skill','memory')),
  target      TEXT NOT NULL,
  scope       TEXT NOT NULL,
  hash        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL
) STRICT`,
        `CREATE TABLE cap_knowledge_skills (
  scope           TEXT NOT NULL,
  name            TEXT NOT NULL,
  dir             TEXT NOT NULL,
  layout          TEXT NOT NULL CHECK (layout IN ('dir','file')),
  description     TEXT NOT NULL,
  model_invocable INTEGER NOT NULL,
  created_by      TEXT NOT NULL CHECK (created_by IN ('user','agent','unknown')),
  tree_hash       TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (scope, name)
) STRICT`,
        `CREATE TABLE cap_knowledge_ledger (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id       TEXT NOT NULL UNIQUE,
  at              INTEGER NOT NULL,
  actor           TEXT NOT NULL,
  target_kind     TEXT NOT NULL,
  target_name     TEXT NOT NULL,
  target_scope    TEXT,
  target_path     TEXT NOT NULL,
  op              TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('prepared','applied','aborted')),
  before_hash     TEXT,
  after_hash      TEXT,
  before_manifest TEXT,
  after_manifest  TEXT,
  request_id      TEXT UNIQUE,
  approved_by     TEXT,
  evidence        TEXT,
  scan            TEXT NOT NULL,
  reason          TEXT,
  proposal_id     TEXT,
  rollback_of     TEXT,
  rolled_back_by  TEXT,
  index_changed   INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT
) STRICT`,
        "CREATE INDEX cap_knowledge_ledger_target ON cap_knowledge_ledger(target_kind, target_name, seq)",
      ],
    },
  ],
};
