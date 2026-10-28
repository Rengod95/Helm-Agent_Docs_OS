import { eachAsync, err, ok, type Result } from "@xeon/contracts";
import type {
  CallOptions,
  KnowledgeHit,
  KnowledgeKind,
  KnowledgeQueryInput,
  KnowledgeQueryOutput,
  SessionListInput,
  SessionListOutput,
  SessionMessage,
  SessionMessagesOutput,
  SessionReadInput,
  SessionScrollInput,
  SkillScope,
} from "@xeon/contracts/capabilities";
import type { SqlRow, SqlTx, StoreDb } from "@xeon/contracts/records";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { KnowledgeSettings } from "../settings.ts";
import { allSkills, type SkillRow } from "../skills/store.ts";
import type { DocRow, DocsIndex } from "./docs-index.ts";
import {
  clipSnippet,
  likeSnippet,
  normalizeQuery,
  queryPath,
  toLikePattern,
  toMatchExpression,
  tokenizeQuery,
} from "./query-model.ts";

// L2.knowledge.plan K9, spec §3.4·§4.8.4 검색 질의. 스킬·메모리는 `cap_knowledge_docsfts`에서, 세션은 `cap_knowledge_sessionfts`에서 같은
// 규칙으로 찾고 종류별 결과를 종류 순(skill → memory → session)으로 이어 붙인다(종류 사이 bm25는 비교할 수 없다).
// 결과는 원문이다. LLM 요약은 하지 않는다.

const KIND_ORDER: readonly KnowledgeKind[] = ["skill", "memory", "session"];
const DEFAULT_LIMIT = 10;
const MAX_SCAN = 200;
const MAX_TEXT_CHARS = 100_000;
const DEFAULT_CONTEXT = 5;
const DEFAULT_READ_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const SNIPPET_TOKENS = 48;

/** 검색 표가 쓸 수 있는지. 능력 판정과 투영기 등록 결과를 합친 값이다 */
export interface SearchAvailability {
  /** 세션 FTS(`sessionfts`, `sessiondocs`)와 소비자를 쓸 수 있다 */
  readonly sessions: boolean;
  /** 스킬·메모리 FTS(`docsfts`)를 쓸 수 있다 */
  readonly docs: boolean;
  /** 쓸 수 없는 이유(진단용) */
  readonly reason: string | undefined;
  /** 세션 목록 표(`sessions`)를 쓸 수 있다. 투영기가 등록되면 FTS와 상관없이 참이다 */
  readonly list: boolean;
}

export interface SearchDeps {
  readonly db: StoreDb;
  readonly settings: (threadId: string | undefined) => KnowledgeSettings;
  readonly availability: SearchAvailability;
  readonly docs: DocsIndex;
}

export interface SearchRuntime {
  query(
    input: KnowledgeQueryInput,
    options?: CallOptions,
  ): Promise<Result<KnowledgeQueryOutput, KnowledgeFailure>>;
  scroll(
    input: SessionScrollInput,
    options?: CallOptions,
  ): Result<SessionMessagesOutput, KnowledgeFailure>;
  read(
    input: SessionReadInput,
    options?: CallOptions,
  ): Result<SessionMessagesOutput, KnowledgeFailure>;
  list(input: SessionListInput, options?: CallOptions): Result<SessionListOutput, KnowledgeFailure>;
}

function textCell(row: SqlRow, column: string): string {
  const value = row[column];
  return typeof value === "string" ? value : "";
}

function intCell(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : 0;
}

function numberCell(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : undefined;
}

function unavailable(reason: string, message: string): KnowledgeFailure {
  return failure("unavailable", message, { detail: { reason } });
}

interface SessionFilter {
  readonly clauses: string[];
  readonly params: (string | number)[];
}

/** 세션 종류·프로젝트·시각·세션 ID 조건. 열 이름은 `sessiondocs`가 d, `sessions`가 s다 */
function sessionFilter(
  input: KnowledgeQueryInput,
  hidden: boolean,
  project: string | null | undefined,
): SessionFilter {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (!hidden) clauses.push("(s.kind = 'main' OR s.kind IS NULL)");
  if (input.sessionIds !== undefined && input.sessionIds.length > 0) {
    clauses.push(`d.thread_id IN (${input.sessionIds.map(() => "?").join(", ")})`);
    params.push(...input.sessionIds);
  }
  if (project !== undefined) {
    // 현재 세션의 프로젝트를 알면 같은 프로젝트의 세션만, 모르면(project === null) 아무 세션도 맞지 않는다
    if (project === null) clauses.push("0");
    else {
      clauses.push("s.project = ?");
      params.push(project);
    }
  }
  if (input.after !== undefined) {
    clauses.push("d.recorded_at >= ?");
    params.push(input.after);
  }
  if (input.before !== undefined) {
    clauses.push("d.recorded_at <= ?");
    params.push(input.before);
  }
  return { clauses, params };
}

function projectOf(tx: SqlTx, threadId: string | undefined): string | null {
  if (threadId === undefined) return null;
  const row = tx.get("SELECT project FROM cap_knowledge_sessions WHERE thread_id = ?", [threadId]);
  const project = row?.["project"];
  return typeof project === "string" ? project : null;
}

export function createSearch(deps: SearchDeps): SearchRuntime {
  const { db, availability } = deps;

  const sessionHits = (
    input: KnowledgeQueryInput,
    tokens: readonly string[],
    path: "fts" | "like",
    limit: number,
    options: CallOptions | undefined,
  ): Result<KnowledgeHit[], KnowledgeFailure> => {
    const settings = deps.settings(options?.context?.threadId).search;
    const hidden = input.includeHidden ?? settings.includeHiddenDefault;
    const scope = input.scope ?? settings.defaultScope;
    const read = db.read((tx): KnowledgeHit[] => {
      const project = scope === "project" ? projectOf(tx, options?.context?.threadId) : undefined;
      const filter = sessionFilter(input, hidden, project);
      const where = filter.clauses.length === 0 ? "" : ` AND ${filter.clauses.join(" AND ")}`;
      if (path === "fts") {
        const rows = tx.all(
          `SELECT d.thread_id AS thread_id, d.seq AS seq, d.role AS role, d.recorded_at AS at,
                  snippet(cap_knowledge_sessionfts, 1, '', '', '…', ${String(SNIPPET_TOKENS)}) AS snip,
                  bm25(cap_knowledge_sessionfts) AS score, s.title AS title
           FROM cap_knowledge_sessionfts
           JOIN cap_knowledge_sessiondocs d ON d.doc_id = cap_knowledge_sessionfts.rowid
           LEFT JOIN cap_knowledge_sessions s ON s.thread_id = d.thread_id
           WHERE cap_knowledge_sessionfts MATCH ?${where}
           ORDER BY score ASC, d.recorded_at DESC, d.doc_id DESC LIMIT ?`,
          [toMatchExpression(tokens), ...filter.params, limit],
        );
        return rows.map((row) =>
          hitOfSession(row, clipSnippet(textCell(row, "snip")), numberCell(row, "score")),
        );
      }
      // LIKE 경로: 최근 문서부터 likeScanLimit개 안에서만 찾는다
      const likes = tokens.map(() => "f.text LIKE ? ESCAPE '\\'").join(" AND ");
      const rows = tx.all(
        `SELECT d.thread_id AS thread_id, d.seq AS seq, d.role AS role, d.recorded_at AS at,
                f.text AS text, s.title AS title
         FROM (
           SELECT d.doc_id, d.thread_id, d.seq, d.role, d.recorded_at
           FROM cap_knowledge_sessiondocs d
           LEFT JOIN cap_knowledge_sessions s ON s.thread_id = d.thread_id
           WHERE 1 = 1${where}
           ORDER BY d.recorded_at DESC, d.doc_id DESC LIMIT ?
         ) d
         JOIN cap_knowledge_sessionfts f ON f.rowid = d.doc_id
         LEFT JOIN cap_knowledge_sessions s ON s.thread_id = d.thread_id
         WHERE ${likes}
         ORDER BY d.recorded_at DESC, d.doc_id DESC LIMIT ?`,
        [...filter.params, settings.likeScanLimit, ...tokens.map(toLikePattern), limit],
      );
      return rows.map((row) =>
        hitOfSession(row, likeSnippet(textCell(row, "text"), tokens), undefined),
      );
    });
    return read.ok ? ok(read.value) : err(fromStoreError(read.error, "session search"));
  };

  /** 스킬·메모리 문서에서 찾는다. FTS 표가 있으면 표에서, 없거나 짧은 질의면 문서 목록을 LIKE로 거른다 */
  const docHits = async (
    kind: "skill" | "memory",
    input: KnowledgeQueryInput,
    tokens: readonly string[],
    path: "fts" | "like",
    limit: number,
    options: CallOptions | undefined,
  ): Promise<Result<KnowledgeHit[], KnowledgeFailure>> => {
    const hidden =
      input.includeHidden ?? deps.settings(options?.context?.threadId).search.includeHiddenDefault;
    // 가려진 스킬과 다른 범위에 가린 스킬을 걸러 내려고 넉넉히 가져온다
    const fetchCount = Math.min(MAX_SCAN, limit * 4);
    let found: { doc: DocRow; snippet: string; score: number | undefined }[];
    if (availability.docs && path === "fts") {
      const read = db.read((tx) =>
        tx.all(
          `SELECT kind, ref, scope, title, body,
                  snippet(cap_knowledge_docsfts, -1, '', '', '…', ${String(SNIPPET_TOKENS)}) AS snip,
                  bm25(cap_knowledge_docsfts) AS score
           FROM cap_knowledge_docsfts
           WHERE cap_knowledge_docsfts MATCH ? AND kind = ?
           ORDER BY score ASC LIMIT ?`,
          [toMatchExpression(tokens), kind, fetchCount],
        ),
      );
      if (!read.ok) return err(fromStoreError(read.error, "docs search"));
      found = read.value.map((row) => ({
        doc: docOfRow(row),
        snippet: clipSnippet(textCell(row, "snip")),
        score: numberCell(row, "score"),
      }));
    } else {
      const collected = await deps.docs.collect();
      if (!collected.ok) return collected;
      found = collected.value
        .filter((doc) => doc.kind === kind)
        .filter((doc) => {
          const haystack = `${doc.title}\n${doc.body}`.toLowerCase();
          return tokens.every((token) => haystack.includes(token.toLowerCase()));
        })
        .slice(0, fetchCount)
        .map((doc) => ({ doc, snippet: likeSnippet(doc.body, tokens), score: undefined }));
    }
    if (kind === "memory") {
      return ok(
        found.slice(0, limit).map(({ doc, snippet, score }) => hitOfDoc(doc, snippet, score)),
      );
    }
    const skills = db.read((tx) => allSkills(tx));
    if (!skills.ok) return err(fromStoreError(skills.error, "skill index"));
    const visible = visibleSkills(skills.value, hidden);
    return ok(
      found
        .filter(({ doc }) => visible.has(`${doc.scope}\u0000${doc.ref}`))
        .slice(0, limit)
        .map(({ doc, snippet, score }) => hitOfDoc(doc, snippet, score)),
    );
  };

  const query: SearchRuntime["query"] = async (input, options) => {
    const settings = deps.settings(options?.context?.threadId).search;
    if (!settings.enabled) {
      return err(failure("unavailable", "search is turned off (l2.knowledge.search.enabled)"));
    }
    const normalized = normalizeQuery(input.query);
    const { tokens } = tokenizeQuery(normalized);
    if (tokens.length === 0) return err(failure("invalid_input", "the query is empty"));
    const kinds = KIND_ORDER.filter((kind) => (input.kinds ?? KIND_ORDER).includes(kind));
    const limit = input.limit ?? DEFAULT_LIMIT;
    // 스킬·메모리 FTS 표가 없으면 LIKE 경로로 찾으므로 경로 표시도 like다
    const wantsDocs = kinds.includes("skill") || kinds.includes("memory");
    const path = queryPath(tokens) === "like" || (wantsDocs && !availability.docs) ? "like" : "fts";
    const degraded: KnowledgeKind[] = [];
    const wantsSession = kinds.includes("session");
    if (wantsSession && !availability.sessions) {
      if (kinds.length === 1) {
        return err(
          unavailable(
            "fts5_unavailable",
            `session search is unavailable: ${availability.reason ?? "FTS5 with the trigram tokenizer is missing"}`,
          ),
        );
      }
      degraded.push("session");
    }
    const hits: KnowledgeHit[] = [];
    // 종류마다 차례로 찾아 종류 순으로 이어 붙인다. 앞 종류가 한도를 채우면 뒤 종류는 찾지 않는다
    const stopped = await eachAsync(kinds, async (kind) => {
      if (kind === "session" && !availability.sessions) return undefined;
      const room = limit - hits.length;
      if (room <= 0) return undefined;
      const found =
        kind === "session"
          ? sessionHits(input, tokens, path, room, options)
          : await docHits(kind, input, tokens, path, room, options);
      if (!found.ok) return { value: found.error };
      hits.push(...found.value);
      return undefined;
    });
    if (stopped !== undefined) return err(stopped.value);
    return ok({ hits, path, ...(degraded.length === 0 ? {} : { degraded }) });
  };

  const requireSessions = (): KnowledgeFailure | undefined =>
    availability.sessions
      ? undefined
      : unavailable(
          "fts5_unavailable",
          `session search is unavailable: ${availability.reason ?? "FTS5 with the trigram tokenizer is missing"}`,
        );

  const scroll: SearchRuntime["scroll"] = (input, options) => {
    if (!deps.settings(options?.context?.threadId).search.enabled) {
      return err(failure("unavailable", "search is turned off (l2.knowledge.search.enabled)"));
    }
    const off = requireSessions();
    if (off !== undefined) return err(off);
    const before = input.before ?? DEFAULT_CONTEXT;
    const after = input.after ?? DEFAULT_CONTEXT;
    const read = db.read((tx) =>
      tx.all(
        `SELECT d.thread_id AS thread_id, d.seq AS seq, d.role AS role, d.recorded_at AS at, f.text AS text
         FROM cap_knowledge_sessiondocs d
         JOIN cap_knowledge_sessionfts f ON f.rowid = d.doc_id
         WHERE d.thread_id = ? AND d.seq BETWEEN ? AND ? ORDER BY d.seq`,
        [input.sessionId, Math.max(1, input.aroundSeq - before), input.aroundSeq + after],
      ),
    );
    if (!read.ok) return err(fromStoreError(read.error, "session scroll"));
    if (read.value.length === 0) {
      return err(
        failure(
          "not_found",
          `session ${input.sessionId} has no message near ${String(input.aroundSeq)}`,
        ),
      );
    }
    return ok({ messages: messagesOf(read.value) });
  };

  const read: SearchRuntime["read"] = (input, options) => {
    if (!deps.settings(options?.context?.threadId).search.enabled) {
      return err(failure("unavailable", "search is turned off (l2.knowledge.search.enabled)"));
    }
    const off = requireSessions();
    if (off !== undefined) return err(off);
    const limit = input.limit ?? DEFAULT_READ_LIMIT;
    const rows = db.read((tx) =>
      tx.all(
        `SELECT d.thread_id AS thread_id, d.seq AS seq, d.role AS role, d.recorded_at AS at, f.text AS text
         FROM cap_knowledge_sessiondocs d
         JOIN cap_knowledge_sessionfts f ON f.rowid = d.doc_id
         WHERE d.thread_id = ? AND d.seq >= ? ORDER BY d.seq LIMIT ?`,
        [input.sessionId, input.fromSeq ?? 1, limit + 1],
      ),
    );
    if (!rows.ok) return err(fromStoreError(rows.error, "session read"));
    if (rows.value.length === 0) {
      return err(
        failure(
          "not_found",
          `session ${input.sessionId} has no message from ${String(input.fromSeq ?? 1)}`,
        ),
      );
    }
    const more = rows.value.length > limit;
    const messages = messagesOf(rows.value.slice(0, limit));
    const last = messages.at(-1);
    return ok({
      messages,
      ...(more && last !== undefined ? { nextSeq: last.seq + 1 } : {}),
    });
  };

  const list: SearchRuntime["list"] = (input, options) => {
    if (!availability.list) {
      return err(unavailable("session_index_missing", "the session list is not available"));
    }
    const settings = deps.settings(options?.context?.threadId).search;
    const hidden = input.includeHidden ?? settings.includeHiddenDefault;
    const scope = input.scope ?? settings.defaultScope;
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const rows = db.read((tx) => {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (!hidden) clauses.push("kind = 'main'");
      if (scope === "project") {
        const project = projectOf(tx, options?.context?.threadId);
        if (project === null) clauses.push("0");
        else {
          clauses.push("project = ?");
          params.push(project);
        }
      }
      if (input.before !== undefined) {
        clauses.push("last_at < ?");
        params.push(input.before);
      }
      return tx.all(
        `SELECT thread_id, kind, title, created_at, last_at, messages FROM cap_knowledge_sessions
         ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
         ORDER BY last_at DESC, thread_id DESC LIMIT ?`,
        [...params, limit],
      );
    });
    if (!rows.ok) return err(fromStoreError(rows.error, "session list"));
    return ok({ sessions: rows.value.map(listItemOf) });
  };

  return { query, scroll, read, list };
}

function messagesOf(rows: readonly SqlRow[]): SessionMessage[] {
  return rows.map((row) => {
    const text = textCell(row, "text");
    const points = Array.from(text);
    const truncated = points.length > MAX_TEXT_CHARS;
    return {
      sessionId: textCell(row, "thread_id"),
      seq: intCell(row, "seq"),
      role: textCell(row, "role") === "assistant" ? "assistant" : "user",
      at: intCell(row, "at"),
      text: truncated ? points.slice(0, MAX_TEXT_CHARS).join("") : text,
      truncated,
    };
  });
}

function listItemOf(row: SqlRow): SessionListOutput["sessions"][number] {
  const title = row["title"];
  const kind = textCell(row, "kind");
  return {
    sessionId: textCell(row, "thread_id"),
    ...(typeof title === "string" && title !== "" ? { title } : {}),
    kind: kind === "subagent" || kind === "background" || kind === "cron" ? kind : "main",
    createdAt: intCell(row, "created_at"),
    lastAt: intCell(row, "last_at"),
    messages: intCell(row, "messages"),
  };
}

function hitOfSession(row: SqlRow, snippet: string, score: number | undefined): KnowledgeHit {
  const thread = textCell(row, "thread_id");
  const seq = intCell(row, "seq");
  const title = row["title"];
  return {
    kind: "session",
    ref: `${thread}:${String(seq)}`,
    title: typeof title === "string" && title !== "" ? title.slice(0, 256) : "(untitled session)",
    snippet,
    ...(score === undefined ? {} : { score }),
    sessionId: thread,
    seq,
    role: textCell(row, "role") === "assistant" ? "assistant" : "user",
    at: intCell(row, "at"),
  };
}

function docOfRow(row: SqlRow): DocRow {
  const kind = textCell(row, "kind");
  return {
    kind: kind === "memory" ? "memory" : "skill",
    ref: textCell(row, "ref"),
    scope: textCell(row, "scope"),
    title: textCell(row, "title"),
    body: textCell(row, "body"),
  };
}

function hitOfDoc(doc: DocRow, snippet: string, score: number | undefined): KnowledgeHit {
  return {
    kind: doc.kind,
    ref: doc.ref,
    title: doc.title.slice(0, 256),
    snippet,
    ...(score === undefined ? {} : { score }),
  };
}

const SCOPE_RANK: Readonly<Record<SkillScope, number>> = {
  project: 0,
  user: 1,
  extension: 2,
  path: 3,
};

/** 모델이 이름으로 보는 스킬(같은 이름은 앞 범위가 이긴다)의 `<범위>\0<이름>` 집합. 가린 스킬은 `hidden`일 때만 든다 */
function visibleSkills(rows: readonly SkillRow[], hidden: boolean): ReadonlySet<string> {
  const best = new Map<string, SkillRow>();
  for (const row of rows) {
    const current = best.get(row.name);
    if (current === undefined || SCOPE_RANK[row.scope] < SCOPE_RANK[current.scope]) {
      best.set(row.name, row);
    }
  }
  return new Set(
    [...best.values()]
      .filter((row) => hidden || row.modelInvocable)
      .map((row) => `${row.scope}\u0000${row.name}`),
  );
}
