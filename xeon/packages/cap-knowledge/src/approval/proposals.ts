import { err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  KnowledgeActorSchema,
  LedgerOpSchema,
  ProposalStatusSchema,
  ScanSummarySchema,
  type KnowledgeActor,
  type LedgerOp,
  type Proposal,
  type ProposalStatus,
  type ScanSummary,
  type WritableSkillScope,
} from "@xeon/contracts/capabilities";
import { BlobRefSchema, type BlobRef, type SqlRow, type SqlTx } from "@xeon/contracts/records";
import type { Static, TSchema } from "typebox";
import { failure, type KnowledgeFailure } from "../errors.ts";

// L2.knowledge.spec §3.8, §4.5.2 `cap_knowledge_proposals` 행의 입출력. JSON 열은 읽을 때마다 스키마로 검증하고, 맞지 않는
// 행은 값(`internal`)으로 돌려준다(TY-24).

/** 대기열이 저장하고 `decide`가 같은 쓰기 경로로 다시 실행하는 메서드 */
export type ProposalMethod =
  | "skills.create"
  | "skills.edit"
  | "skills.patch"
  | "skills.writeFile"
  | "skills.remove"
  | "memory.add"
  | "memory.replace"
  | "memory.remove"
  | "memory.manage"
  | "ledger.rollback";

const METHODS: readonly ProposalMethod[] = [
  "skills.create",
  "skills.edit",
  "skills.patch",
  "skills.writeFile",
  "skills.remove",
  "memory.add",
  "memory.replace",
  "memory.remove",
  "memory.manage",
  "ledger.rollback",
];

function isProposalMethod(value: string): value is ProposalMethod {
  return METHODS.some((method) => method === value);
}

export interface ProposalRecord {
  readonly proposal: Proposal;
  readonly method: ProposalMethod;
  /** 메서드 입력 JSON을 담은 blob */
  readonly input: BlobRef;
  readonly requestId: string | null;
  readonly decidedAt: number | null;
}

export interface NewProposal {
  readonly proposalId: string;
  readonly createdAt: number;
  readonly actor: KnowledgeActor;
  readonly method: ProposalMethod;
  readonly input: BlobRef;
  readonly target: Proposal["target"];
  readonly op: LedgerOp;
  readonly baseHash: string | null;
  readonly scan: ScanSummary;
  readonly preview: string;
  readonly requestId: string | undefined;
}

function textOf(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function intOf(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : undefined;
}

function textOrNull(row: SqlRow, column: string): string | null | undefined {
  const value = row[column];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function malformed(column: string): KnowledgeFailure {
  return failure("internal", `proposal row is malformed: ${column}`);
}

function decode<S extends TSchema>(
  schema: S,
  text: string | undefined,
  column: string,
): Result<Static<S>, KnowledgeFailure> {
  if (text === undefined) return err(malformed(column));
  const json = parseJson(text);
  if (!json.ok) return err(malformed(column));
  const checked = parse(schema, json.value);
  return checked.ok ? ok(checked.value) : err(malformed(column));
}

function toRecord(row: SqlRow): Result<ProposalRecord, KnowledgeFailure> {
  const actor = decode(KnowledgeActorSchema, textOf(row, "actor"), "actor");
  if (!actor.ok) return actor;
  const scan = decode(ScanSummarySchema, textOf(row, "scan"), "scan");
  if (!scan.ok) return scan;
  const input = decode(BlobRefSchema, textOf(row, "input"), "input");
  if (!input.ok) return input;
  const status = parse(ProposalStatusSchema, textOf(row, "status"));
  if (!status.ok) return err(malformed("status"));
  const op = parse(LedgerOpSchema, textOf(row, "op"));
  if (!op.ok) return err(malformed("op"));
  const method = textOf(row, "method");
  if (method === undefined || !isProposalMethod(method)) return err(malformed("method"));
  const kind = textOf(row, "target_kind");
  const name = textOf(row, "target_name");
  if ((kind !== "skill" && kind !== "memory") || name === undefined) {
    return err(malformed("target"));
  }
  const scopeText = textOrNull(row, "target_scope");
  const scope: WritableSkillScope | undefined =
    scopeText === "user" || scopeText === "project" ? scopeText : undefined;
  const proposalId = textOf(row, "proposal_id");
  const createdAt = intOf(row, "created_at");
  const baseHash = textOrNull(row, "base_hash");
  const preview = textOf(row, "preview");
  const ledgerId = textOrNull(row, "ledger_id");
  const requestId = textOrNull(row, "request_id");
  const decidedAt = row["decided_at"] === null ? null : (intOf(row, "decided_at") ?? null);
  if (proposalId === undefined) return err(malformed("proposal_id"));
  if (createdAt === undefined) return err(malformed("created_at"));
  if (baseHash === undefined) return err(malformed("base_hash"));
  if (preview === undefined) return err(malformed("preview"));
  if (ledgerId === undefined) return err(malformed("ledger_id"));
  if (requestId === undefined) return err(malformed("request_id"));
  const proposal: Proposal = {
    proposalId,
    createdAt,
    actor: actor.value,
    target: { kind, name, ...(scope === undefined ? {} : { scope }) },
    op: op.value,
    baseHash,
    status: status.value,
    preview,
    scan: scan.value,
    ...(ledgerId === null ? {} : { ledgerId }),
  };
  return ok({ proposal, method, input: input.value, requestId, decidedAt });
}

const json = (value: unknown): string => JSON.stringify(value);

export function insertProposal(tx: SqlTx, row: NewProposal): void {
  tx.run(
    `INSERT INTO cap_knowledge_proposals (
       proposal_id, created_at, actor, method, input, target_kind, target_name, target_scope, op,
       base_hash, status, scan, preview, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      row.proposalId,
      row.createdAt,
      json(row.actor),
      row.method,
      json(row.input),
      row.target.kind,
      row.target.name,
      row.target.scope ?? null,
      row.op,
      row.baseHash,
      json(row.scan),
      row.preview,
      row.requestId ?? null,
    ],
  );
}

export function findProposal(
  tx: SqlTx,
  proposalId: string,
): Result<ProposalRecord | undefined, KnowledgeFailure> {
  const row = tx.get("SELECT * FROM cap_knowledge_proposals WHERE proposal_id = ?", [proposalId]);
  return row === undefined ? ok(undefined) : toRecord(row);
}

export function findProposalByRequestId(
  tx: SqlTx,
  requestId: string,
): Result<ProposalRecord | undefined, KnowledgeFailure> {
  const row = tx.get("SELECT * FROM cap_knowledge_proposals WHERE request_id = ?", [requestId]);
  return row === undefined ? ok(undefined) : toRecord(row);
}

/** 최신순. 상태를 주면 그 상태만 */
export function listProposals(
  tx: SqlTx,
  query: { readonly status?: ProposalStatus; readonly limit: number },
): Result<readonly ProposalRecord[], KnowledgeFailure> {
  const rows =
    query.status === undefined
      ? tx.all(
          "SELECT * FROM cap_knowledge_proposals ORDER BY created_at DESC, proposal_id DESC LIMIT ?",
          [query.limit],
        )
      : tx.all(
          "SELECT * FROM cap_knowledge_proposals WHERE status = ? ORDER BY created_at DESC, proposal_id DESC LIMIT ?",
          [query.status, query.limit],
        );
  const records: ProposalRecord[] = [];
  for (const row of rows) {
    const record = toRecord(row);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

/** pending인 제안만 새 상태로 바꾼다. 이미 닫힌 제안이면 false(경쟁에서 졌다) */
export function closeProposal(
  tx: SqlTx,
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
  decidedAt: number,
  ledgerId: string | undefined,
): boolean {
  const before = tx.get(
    "SELECT status FROM cap_knowledge_proposals WHERE proposal_id = ? AND status = 'pending'",
    [proposalId],
  );
  if (before === undefined) return false;
  tx.run(
    "UPDATE cap_knowledge_proposals SET status = ?, decided_at = ?, ledger_id = ? WHERE proposal_id = ?",
    [status, decidedAt, ledgerId ?? null, proposalId],
  );
  return true;
}

/** 만든 지 `olderThan`(epoch ms)보다 오래된 pending 제안을 expired로 바꾸고 개수를 돌려준다 */
export function expirePending(tx: SqlTx, olderThan: number, now: number): number {
  const stale = tx.all(
    "SELECT proposal_id FROM cap_knowledge_proposals WHERE status = 'pending' AND created_at < ?",
    [olderThan],
  );
  tx.run(
    "UPDATE cap_knowledge_proposals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?",
    [now, olderThan],
  );
  return stale.length;
}
