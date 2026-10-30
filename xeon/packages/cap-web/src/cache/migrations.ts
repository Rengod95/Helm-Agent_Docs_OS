import type { MigrationSet } from "@xeon/contracts/records";

// L2.web.spec §3.8. 세션 밖 상태다. 소유자 `cap.web`, 테이블 접두 `cap_web_`.
// `cap_web_raw`는 rawRef 재조회가 Source를 다시 만들 수 있도록 원문의 출처 열(url ~ published_at)을 더 가진다(L2.web.plan §8.4).

export const WEB_STORE_OWNER = "cap.web";

export const CAP_WEB_MIGRATIONS: MigrationSet = {
  owner: WEB_STORE_OWNER,
  version: 2,
  steps: [
    {
      version: 1,
      sql: [
        `CREATE TABLE cap_web_raw (
  raw_ref       TEXT PRIMARY KEY,
  retention     TEXT NOT NULL CHECK (retention IN ('session','persist')),
  session_id    TEXT,
  raw_blob      TEXT NOT NULL,
  text_blob     TEXT NOT NULL,
  text_chars    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  url           TEXT NOT NULL,
  final_url     TEXT,
  provider      TEXT NOT NULL,
  status        INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  method        TEXT NOT NULL,
  title         TEXT,
  published_at  TEXT
) STRICT`,
        `CREATE TABLE cap_web_fetch_cache (
  cache_key     TEXT PRIMARY KEY,
  url_norm      TEXT NOT NULL,
  final_url     TEXT,
  provider      TEXT NOT NULL,
  status        INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  raw_ref       TEXT NOT NULL,
  method        TEXT NOT NULL,
  title         TEXT,
  published_at  TEXT,
  retrieved_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
) STRICT`,
        "CREATE INDEX cap_web_fetch_cache_expires ON cap_web_fetch_cache(expires_at)",
        "CREATE INDEX cap_web_fetch_cache_raw ON cap_web_fetch_cache(raw_ref)",
        `CREATE TABLE cap_web_usage (
  provider      TEXT NOT NULL,
  month         TEXT NOT NULL,
  unit          TEXT NOT NULL,
  count         REAL NOT NULL,
  usd           REAL NOT NULL,
  PRIMARY KEY (provider, month, unit)
) STRICT`,
      ],
    },
    {
      // 키 플러그인 첫 사용 고지(L2.web.spec §4.8.2). provider ID마다 한 행이다
      version: 2,
      sql: [
        `CREATE TABLE cap_web_notices (
  provider      TEXT PRIMARY KEY,
  noticed_at    INTEGER NOT NULL
) STRICT`,
      ],
    },
  ],
};
