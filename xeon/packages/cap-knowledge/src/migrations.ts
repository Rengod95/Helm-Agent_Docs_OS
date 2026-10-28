import type { MigrationSet } from "@xeon/contracts/records";

// L2.knowledge.spec §3.8 세션 밖 상태 테이블. 소유자 `cap.knowledge`, 테이블 접두 `cap_knowledge_`(F owners.ts).
// 마이그레이션은 작업마다 단계를 더한다. 1단계(KN.1)는 파일 상태, 스킬 색인, 원장이다. 2단계(KN.2)는 제안 대기열이고,
// 문서 FTS와 세션 검색 커서(KN.4)는 3단계 이후로 더한다(체크섬이 적용된 단계를 바꾸지 못하게 한다).

export const KNOWLEDGE_OWNER = "cap.knowledge";

export const KNOWLEDGE_MIGRATIONS: MigrationSet = {
  owner: KNOWLEDGE_OWNER,
  version: 3,
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
    {
      version: 2,
      sql: [
        // spec §3.8 DDL에 `target_scope`와 `preview`를 더했다. 대기열 목록(`Proposal`)이 대상 범위와 사람이 볼 diff를 돌려주기 때문이다
        `CREATE TABLE cap_knowledge_proposals (
  proposal_id  TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  actor        TEXT NOT NULL,
  method       TEXT NOT NULL,
  input        TEXT NOT NULL,
  target_kind  TEXT NOT NULL,
  target_name  TEXT NOT NULL,
  target_scope TEXT,
  op           TEXT NOT NULL,
  base_hash    TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','applied','rejected','stale','expired')),
  scan         TEXT NOT NULL,
  preview      TEXT NOT NULL,
  decided_at   INTEGER,
  ledger_id    TEXT,
  request_id   TEXT UNIQUE
) STRICT`,
        "CREATE INDEX cap_knowledge_proposals_status ON cap_knowledge_proposals(status, created_at)",
      ],
    },
    {
      version: 3,
      sql: [
        // M3-REQ-91: 쓰기를 한 turn이 untrusted 도구 결과를 읽었는지(`CallerInfo.afterUntrusted`)를 원장과 대기열에 남긴다
        "ALTER TABLE cap_knowledge_ledger ADD COLUMN after_untrusted INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cap_knowledge_proposals ADD COLUMN after_untrusted INTEGER NOT NULL DEFAULT 0",
      ],
    },
  ],
};
