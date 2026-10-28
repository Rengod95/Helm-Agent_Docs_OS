import { err, ok, parseJson, type Result } from "@xeon/contracts";
import type {
  DurableEventEnvelope,
  ProjectionTx,
  Projector,
  SqlRow,
  SqlTx,
  SqlValue,
  StoreDb,
} from "@xeon/contracts/records";
import { decodeEvent, LEARNING_EVENT_KINDS } from "./events.ts";
import { parseProposal, type Proposal } from "./proposal.ts";
import {
  sortProposals,
  type LearningQueueReader,
  type ProposalFilter,
  type ReviewFilter,
  type ReviewOutcome,
  type ReviewRow,
  type StoreFailure,
} from "./reader.ts";
import { applyLearningEvent, type ProjectionRows } from "./rows.ts";

// L3.learning.spec §3.7.2 `x_learning_proposals`·`x_learning_reviews`. 소유자는 `ext.learning`이고 표 접두는 `x_learning_`다(F owners).
// 이 파일은 DDL, 투영기, 읽기 구현을 한곳에 둔다. 읽기와 투영이 같은 행 변환을 쓴다.

const PROPOSALS_DDL = `CREATE TABLE x_learning_proposals (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  op              TEXT NOT NULL,
  target          TEXT NOT NULL,
  status          TEXT NOT NULL,
  reason          TEXT,
  revision        INTEGER NOT NULL,
  body_hash       TEXT NOT NULL,
  base_hash       TEXT,
  diff            TEXT NOT NULL,
  body            TEXT NOT NULL,
  description     TEXT,
  rationale       TEXT NOT NULL,
  evidence_json   TEXT NOT NULL,
  review_id       TEXT,
  conflicts_with  TEXT,
  destructive     INTEGER NOT NULL,
  scope           TEXT NOT NULL,
  after_untrusted INTEGER NOT NULL,
  findings_json   TEXT NOT NULL,
  ledger_id       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT`;

const REVIEWS_DDL = `CREATE TABLE x_learning_reviews (
  thread_id        TEXT NOT NULL,
  request_id       TEXT NOT NULL,
  epoch            INTEGER NOT NULL,
  child_thread_id  TEXT NOT NULL,
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  outcome          TEXT,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  PRIMARY KEY (thread_id, request_id)
) STRICT`;

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function integer(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : undefined;
}

function listOf(row: SqlRow, column: string): readonly unknown[] | undefined {
  const raw = text(row, column);
  if (raw === undefined) return undefined;
  const json = parseJson(raw);
  return json.ok && Array.isArray(json.value) ? json.value : undefined;
}

function proposalOfRow(row: SqlRow): Proposal | undefined {
  const parsed = parseProposal({
    id: text(row, "id"),
    kind: text(row, "kind"),
    op: text(row, "op"),
    target: text(row, "target"),
    diff: text(row, "diff"),
    body: text(row, "body"),
    description: text(row, "description") ?? null,
    bodyHash: text(row, "body_hash"),
    baseHash: text(row, "base_hash") ?? null,
    rationale: text(row, "rationale"),
    evidenceEventIds: listOf(row, "evidence_json"),
    threadId: text(row, "thread_id"),
    status: text(row, "status"),
    reviewId: text(row, "review_id") ?? null,
    conflictsWith: text(row, "conflicts_with") ?? null,
    destructive: integer(row, "destructive") === 1,
    scope: text(row, "scope"),
    afterUntrusted: integer(row, "after_untrusted") === 1,
    reason: text(row, "reason") ?? null,
    findings: listOf(row, "findings_json"),
    ledgerId: text(row, "ledger_id") ?? null,
    createdAt: integer(row, "created_at"),
    updatedAt: integer(row, "updated_at"),
    revision: integer(row, "revision"),
  });
  return parsed.ok ? parsed.value : undefined;
}

const OUTCOMES: readonly ReviewOutcome[] = ["completed", "aborted", "error", "budget"];

function reviewOfRow(row: SqlRow): ReviewRow | undefined {
  const requestId = text(row, "request_id");
  const threadId = text(row, "thread_id");
  const childThreadId = text(row, "child_thread_id");
  const epoch = integer(row, "epoch");
  const startedAt = integer(row, "started_at");
  const inputTokens = integer(row, "input_tokens");
  const outputTokens = integer(row, "output_tokens");
  const outcomeText = text(row, "outcome");
  const outcome = OUTCOMES.find((candidate) => candidate === outcomeText) ?? null;
  if (
    requestId === undefined ||
    threadId === undefined ||
    childThreadId === undefined ||
    epoch === undefined ||
    startedAt === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    (outcomeText !== undefined && outcome === null)
  ) {
    return undefined;
  }
  return {
    requestId,
    threadId,
    childThreadId,
    epoch,
    startedAt,
    finishedAt: integer(row, "finished_at") ?? null,
    outcome,
    inputTokens,
    outputTokens,
  };
}

function proposalParams(proposal: Proposal): SqlValue[] {
  return [
    proposal.id,
    proposal.threadId,
    proposal.kind,
    proposal.op,
    proposal.target,
    proposal.status,
    proposal.reason,
    proposal.revision,
    proposal.bodyHash,
    proposal.baseHash,
    proposal.diff,
    proposal.body,
    proposal.description,
    proposal.rationale,
    JSON.stringify(proposal.evidenceEventIds),
    proposal.reviewId,
    proposal.conflictsWith,
    proposal.destructive ? 1 : 0,
    proposal.scope,
    proposal.afterUntrusted ? 1 : 0,
    JSON.stringify(proposal.findings),
    proposal.ledgerId,
    proposal.createdAt,
    proposal.updatedAt,
  ];
}

const UPSERT_PROPOSAL = `INSERT OR REPLACE INTO x_learning_proposals (
  id, thread_id, kind, op, target, status, reason, revision, body_hash, base_hash, diff, body, description, rationale,
  evidence_json, review_id, conflicts_with, destructive, scope, after_untrusted, findings_json, ledger_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_REVIEW = `INSERT OR REPLACE INTO x_learning_reviews
 (thread_id, request_id, epoch, child_thread_id, started_at, finished_at, outcome, input_tokens, output_tokens)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function sqlRows(tx: ProjectionTx): ProjectionRows {
  return {
    getProposal(id) {
      const row = tx.get("SELECT * FROM x_learning_proposals WHERE id = ?", [id]);
      return row === undefined ? undefined : proposalOfRow(row);
    },
    putProposal(proposal) {
      tx.run(UPSERT_PROPOSAL, proposalParams(proposal));
    },
    getReview(threadId, requestId) {
      const row = tx.get(
        "SELECT * FROM x_learning_reviews WHERE thread_id = ? AND request_id = ?",
        [threadId, requestId],
      );
      return row === undefined ? undefined : reviewOfRow(row);
    },
    putReview(review) {
      tx.run(UPSERT_REVIEW, [
        review.threadId,
        review.requestId,
        review.epoch,
        review.childThreadId,
        review.startedAt,
        review.finishedAt,
        review.outcome,
        review.inputTokens,
        review.outputTokens,
      ]);
    },
  };
}

/** 투영기(L3.learning.spec §3.7.2). 세션 DB의 투영기 등록부에 조립 루트가 등록한다. `ext.learning`이 소유한다. `onSkipped`는 해독하지 못해 건너뛴 기록의 kind를 받는다(투영은 던지지 않는다: 던지면 커밋이 롤백된다) */
export function createLearningProjector(onSkipped?: (kind: string) => void): Projector {
  return {
    name: "ext.learning",
    version: 1,
    tables: ["x_learning_proposals", "x_learning_reviews"],
    ddl: [
      PROPOSALS_DDL,
      "CREATE INDEX x_learning_pstatus ON x_learning_proposals (status, created_at)",
      REVIEWS_DDL,
      "CREATE INDEX x_learning_rchild ON x_learning_reviews (child_thread_id)",
    ],
    kinds: LEARNING_EVENT_KINDS.map((kind) => `grp.learning.${kind}` as const),
    apply(tx: ProjectionTx, event: DurableEventEnvelope): void {
      const decoded = decodeEvent(event.kind, event.payload);
      if (decoded === undefined) onSkipped?.(event.kind);
      else applyLearningEvent(sqlRows(tx), decoded);
    },
  };
}

export const learningProjector: Projector = createLearningProjector();

function failure(detail: string): StoreFailure {
  return { kind: "learning.storeUnavailable", detail };
}

function proposalsOf(rows: readonly SqlRow[]): Result<readonly Proposal[], StoreFailure> {
  const out: Proposal[] = [];
  for (const row of rows) {
    const parsed = proposalOfRow(row);
    if (parsed === undefined) return err(failure("a learning proposal row is corrupt"));
    out.push(parsed);
  }
  return ok(out);
}
function reviewsOf(rows: readonly SqlRow[]): Result<readonly ReviewRow[], StoreFailure> {
  const out: ReviewRow[] = [];
  for (const row of rows) {
    const parsed = reviewOfRow(row);
    if (parsed === undefined) return err(failure("a learning review row is corrupt"));
    out.push(parsed);
  }
  return ok(out);
}
function oneReviewOf(row: SqlRow | undefined): Result<ReviewRow | undefined, StoreFailure> {
  if (row === undefined) return ok(undefined);
  const parsed = reviewOfRow(row);
  return parsed === undefined ? err(failure("a learning review row is corrupt")) : ok(parsed);
}

/** 세션 DB(`store.scoped("ext.learning")`)의 읽기 구현. 손상된 행은 오류 값이다 */
export function createSqlReader(db: StoreDb): LearningQueueReader {
  function read<T>(fn: (tx: SqlTx) => T): Result<T, StoreFailure> {
    const done = db.read(fn);
    return done.ok ? ok(done.value) : err(failure(`read failed: ${done.error.kind}`));
  }
  return {
    getProposal(id) {
      const found = read((tx) => tx.get("SELECT * FROM x_learning_proposals WHERE id = ?", [id]));
      if (!found.ok) return Promise.resolve(found);
      if (found.value === undefined) return Promise.resolve(ok(undefined));
      const parsed = proposalOfRow(found.value);
      return Promise.resolve(
        parsed === undefined ? err(failure("a learning proposal row is corrupt")) : ok(parsed),
      );
    },
    listProposals(filter: ProposalFilter) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.statuses !== undefined) {
        if (filter.statuses.length === 0) return Promise.resolve(ok([]));
        where.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
        params.push(...filter.statuses);
      }
      if (filter.reviewId !== undefined) {
        where.push("review_id = ?");
        params.push(filter.reviewId);
      }
      const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
      const limit =
        filter.limit === undefined ? "" : ` LIMIT ${String(Math.max(0, Math.floor(filter.limit)))}`;
      const rows = read((tx) =>
        tx.all(
          `SELECT * FROM x_learning_proposals${clause} ORDER BY created_at DESC, id ASC${limit}`,
          params,
        ),
      );
      if (!rows.ok) return Promise.resolve(rows);
      const parsed = proposalsOf(rows.value);
      return Promise.resolve(parsed.ok ? ok(sortProposals(parsed.value)) : parsed);
    },
    getReviewByChild(childThreadId) {
      const found = read((tx) =>
        tx.get("SELECT * FROM x_learning_reviews WHERE child_thread_id = ?", [childThreadId]),
      );
      return Promise.resolve(found.ok ? oneReviewOf(found.value) : found);
    },
    getReview(threadId, requestId) {
      const found = read((tx) =>
        tx.get("SELECT * FROM x_learning_reviews WHERE thread_id = ? AND request_id = ?", [
          threadId,
          requestId,
        ]),
      );
      return Promise.resolve(found.ok ? oneReviewOf(found.value) : found);
    },
    listReviews(filter: ReviewFilter) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.threadId !== undefined) {
        where.push("thread_id = ?");
        params.push(filter.threadId);
      }
      if (filter.unfinished === true) where.push("finished_at IS NULL");
      const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
      const rows = read((tx) =>
        tx.all(
          `SELECT * FROM x_learning_reviews${clause} ORDER BY started_at ASC, request_id ASC`,
          params,
        ),
      );
      return Promise.resolve(rows.ok ? reviewsOf(rows.value) : rows);
    },
  };
}
