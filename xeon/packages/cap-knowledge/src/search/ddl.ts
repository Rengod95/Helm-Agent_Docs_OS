// L2.knowledge.spec §3.8 세션 투영·색인. 투영기 `cap.knowledge`가 이 테이블들을 선언한다. 세션을 지울 때 `thread_id` 열이 있는 표의 행이
// 함께 지워지고(L1.persistence), 투영 버전이 바뀌면 이 표들을 한꺼번에 다시 만든다.
//
// 이름 규칙(F.records.spec §3.4, 투영기 등록부): `cap_knowledge_` 뒤 지역 이름에는 밑줄이 없다. 그래서 spec 초안의
// `session_docs`·`session_fts`·`docs_fts`는 `sessiondocs`·`sessionfts`·`docsfts`로 쓴다 [결정: KN.4].
// 세션 id 열은 `session_id`가 아니라 `thread_id`다: 세션 삭제 정리가 그 이름의 열을 찾는다.

export const KNOWLEDGE_PROJECTOR_NAME = "cap.knowledge";

/** FTS5와 trigram을 쓸 수 있을 때의 투영 버전 */
export const KNOWLEDGE_PROJECTOR_VERSION = 1;
/** 쓸 수 없을 때(FTS 표 없이 세션 목록만)의 버전. 능력이 바뀌면 투영을 다시 만든다 */
export const KNOWLEDGE_PROJECTOR_VERSION_NO_FTS = 1001;

const SESSIONS = `CREATE TABLE cap_knowledge_sessions (
  thread_id    TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('main','subagent','background','cron')),
  project      TEXT,
  title        TEXT,
  created_at   INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  messages     INTEGER NOT NULL DEFAULT 0
) STRICT`;

const SESSION_DOCS = `CREATE TABLE cap_knowledge_sessiondocs (
  doc_id       INTEGER PRIMARY KEY,
  event_id     TEXT NOT NULL UNIQUE,
  thread_id    TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  event_seq    INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  recorded_at  INTEGER NOT NULL,
  chars        INTEGER NOT NULL
) STRICT`;

const SESSION_DOCS_INDEX =
  "CREATE INDEX cap_knowledge_sessiondocs_thread ON cap_knowledge_sessiondocs(thread_id, seq)";
const SESSION_DOCS_RECENT =
  "CREATE INDEX cap_knowledge_sessiondocs_recent ON cap_knowledge_sessiondocs(recorded_at, doc_id)";

const SESSION_FTS = `CREATE VIRTUAL TABLE cap_knowledge_sessionfts USING fts5(
  thread_id UNINDEXED, text, tokenize = 'trigram', detail = 'full'
)`;

/** 소비자 커서. 투영 표라서 투영을 다시 만들면 0으로 돌아가고 색인도 처음부터 다시 쌓인다 */
const CURSOR = `CREATE TABLE cap_knowledge_sessioncursor (
  consumer     TEXT PRIMARY KEY,
  event_seq    INTEGER NOT NULL
) STRICT`;

const DOCS_FTS = `CREATE VIRTUAL TABLE cap_knowledge_docsfts USING fts5(
  kind UNINDEXED, ref UNINDEXED, scope UNINDEXED, title, body, tokenize = 'trigram'
)`;

export const KNOWLEDGE_TABLES_BASE: readonly string[] = ["cap_knowledge_sessions"];
export const KNOWLEDGE_TABLES_FTS: readonly string[] = [
  "cap_knowledge_sessions",
  "cap_knowledge_sessiondocs",
  "cap_knowledge_sessionfts",
  "cap_knowledge_sessioncursor",
  "cap_knowledge_docsfts",
];

export const KNOWLEDGE_DDL_BASE: readonly string[] = [SESSIONS];
export const KNOWLEDGE_DDL_FTS: readonly string[] = [
  SESSIONS,
  SESSION_DOCS,
  SESSION_DOCS_INDEX,
  SESSION_DOCS_RECENT,
  SESSION_FTS,
  CURSOR,
  DOCS_FTS,
];
