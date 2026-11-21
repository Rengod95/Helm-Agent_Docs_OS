import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type {
  DurableEventEnvelope,
  SqlRow,
  SqlTx,
  SqlValue,
  StoreDb,
} from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { payloadOf, type LearningEvent } from "../src/proposals/events.ts";
import type { Proposal } from "../src/proposals/proposal.ts";
import { createLearningProjector, createSqlReader } from "../src/proposals/sql.ts";

// 실제 SQLite(bun:sqlite 메모리 DB) 위에서 투영기의 DDL과 행 쓰기, 읽기 구현을 돈다. 메모(`note`)가 기록 → 표 → 읽기로 그대로 가는지 본다.

function sqlTxOf(db: Database): SqlTx {
  return {
    run(sql, params = []) {
      const result = db.query<SqlRow, SqlValue[]>(sql).run(...params);
      return { changes: result.changes };
    },
    get(sql, params = []) {
      const row = db.query<SqlRow, SqlValue[]>(sql).get(...params);
      return row === null ? undefined : row;
    },
    all(sql, params = []) {
      return db.query<SqlRow, SqlValue[]>(sql).all(...params);
    },
  };
}

/** 세션 DB 핸들의 시험 대역. 쓰기와 읽기가 같은 연결을 쓴다 */
function storeOf(tx: SqlTx): StoreDb {
  return {
    write: (fn) => ok(fn(tx)),
    read: (fn) => ok(fn(tx)),
  };
}

const ids = fixedIdFactory(11);
let seq = 0;

/** 내구 봉투. 투영기는 종류와 payload만 읽는다 */
function recorded(
  kind: "grp.learning.proposal.created" | "grp.learning.proposal.decided",
  payload: JsonValue,
): DurableEventEnvelope {
  seq += 1;
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: ids.next("thr"),
    turnId: null,
    stepId: null,
    recordedAt: 1,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

function pendingProposal(id: string): Proposal {
  return {
    id,
    kind: "skill",
    op: "create",
    target: `release-notes-${id}`,
    diff: "+ x",
    body: "x",
    description: null,
    bodyHash: "0".repeat(64),
    baseHash: null,
    rationale: "r",
    evidenceEventIds: ["evt_1"],
    threadId: "thr_1",
    status: "pending",
    reviewId: "learning:review:1",
    conflictsWith: null,
    destructive: false,
    scope: "user",
    afterUntrusted: false,
    reason: null,
    note: null,
    findings: [],
    ledgerId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    revision: 1,
  };
}

test("sql.note-round-trip: the reject note is written to the table and read back; a row without one reads null", async () => {
  const db = new Database(":memory:");
  const tx = sqlTxOf(db);
  const projector = createLearningProjector();
  for (const statement of projector.ddl) db.run(statement);
  const columns = db
    .query<SqlRow, []>("SELECT name FROM pragma_table_info('x_learning_proposals')")
    .all()
    .map((row) => row["name"]);
  expect(columns).toContain("note");

  const created = [pendingProposal("prop_a"), pendingProposal("prop_b")];
  for (const proposal of created) {
    const event: LearningEvent = { kind: "proposal.created", proposal };
    projector.apply(tx, recorded("grp.learning.proposal.created", payloadOf(event)));
  }
  const rejected: LearningEvent = {
    kind: "proposal.decided",
    id: "prop_a",
    revision: 1,
    status: "rejected",
    reason: "user_rejected",
    scope: "user",
    note: "이 팀 한정",
    at: 1_700_000_000_500,
  };
  projector.apply(tx, recorded("grp.learning.proposal.decided", payloadOf(rejected)));

  const reader = createSqlReader(storeOf(tx));
  expect(await reader.getProposal("prop_a")).toMatchObject({
    ok: true,
    value: { status: "rejected", note: "이 팀 한정" },
  });
  expect(await reader.getProposal("prop_b")).toMatchObject({
    ok: true,
    value: { status: "pending", note: null },
  });
  expect(await reader.listProposals({ statuses: ["rejected"] })).toMatchObject({
    ok: true,
    value: [{ id: "prop_a", note: "이 팀 한정" }],
  });
  db.close();
});

test("sql.projector-version: the table gained a column, so the projector version is 2 and a store at version 1 rebuilds", () => {
  expect(createLearningProjector().version).toBe(2);
});
