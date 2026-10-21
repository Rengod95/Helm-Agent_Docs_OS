import type { MigrationSet } from "@xeon/contracts/records";
import { SYS_OWNER } from "./prefix.ts";

/**
 * owner "sys" 마이그레이션(L0.store.spec §3.3). 한 번 배포한 단계의 SQL은 고치지 않고 새 단계를 더한다(§4.6).
 * 단계는 구현 마일스톤과 같은 순서다: v1 sys_meta·sys_migrations·sys_migration_cursors·sys_prefixes(M0),
 * v2 sys_leases(M0), v3 sys_blobs·sys_blob_refs(M1).
 */
export const SYS_MIGRATION_SET: MigrationSet = {
  owner: SYS_OWNER,
  version: 3,
  steps: [
    {
      version: 1,
      sql: [
        `CREATE TABLE sys_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT`,
        `CREATE TABLE sys_migrations (
  owner          TEXT NOT NULL,
  version        INTEGER NOT NULL CHECK (version >= 1),
  checksum       TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at     INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  PRIMARY KEY (owner, version)
) STRICT`,
        `CREATE TABLE sys_migration_cursors (
  owner        TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  cursor       TEXT,
  processed    INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (owner, migration_id)
) STRICT`,
        `CREATE TABLE sys_prefixes (
  owner         TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('core', 'extension')),
  names         TEXT NOT NULL,
  registered_at INTEGER NOT NULL
) STRICT`,
      ],
    },
    {
      version: 2,
      sql: [
        `CREATE TABLE sys_leases (
  resource     TEXT PRIMARY KEY,
  holder_id    TEXT NOT NULL,
  epoch        INTEGER NOT NULL CHECK (epoch >= 1),
  kind         TEXT NOT NULL CHECK (kind IN ('cli', 'app', 'service')),
  pid          INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  host         TEXT NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  released_at  INTEGER
) STRICT`,
      ],
    },
    {
      version: 3,
      sql: [
        `CREATE TABLE sys_blobs (
  sha256      TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  size        INTEGER NOT NULL CHECK (size >= 0),
  media_type  TEXT,
  created_at  INTEGER NOT NULL,
  last_put_at INTEGER NOT NULL
) STRICT`,
        `CREATE TABLE sys_blob_refs (
  sha256  TEXT NOT NULL REFERENCES sys_blobs(sha256),
  owner   TEXT NOT NULL,
  ref_key TEXT NOT NULL,
  PRIMARY KEY (sha256, owner, ref_key)
) STRICT`,
        "CREATE INDEX sys_blob_refs_by_key ON sys_blob_refs (owner, ref_key)",
      ],
    },
  ],
};
