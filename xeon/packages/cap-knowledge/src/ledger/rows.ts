import { Bug, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  KnowledgeActorSchema,
  ApprovalEvidenceSchema,
  LedgerOpSchema,
  ScanSummarySchema,
  WriteOutcomeSchema,
  type ApprovalEvidence,
  type ApprovedBy,
  type KnowledgeActor,
  type LedgerEntry,
  type LedgerOp,
  type ScanSummary,
  type WriteOutcome,
  type WritableSkillScope,
} from "@xeon/contracts/capabilities";
import {
  BlobRefSchema,
  type BlobRef,
  type SqlRow,
  type SqlTx,
  type SqlValue,
} from "@xeon/contracts/records";
import type { Static, TSchema } from "typebox";
import { failure, type KnowledgeFailure } from "../errors.ts";

// cap_knowledge_ledger 행의 입출력. JSON 열은 읽을 때마다 스키마로 검증한다(TY-10).

type LedgerStatus = "prepared" | "applied" | "aborted";

export interface LedgerTargetRef {
  readonly kind: "skill" | "memory";
  readonly name: string;
  readonly scope?: WritableSkillScope;
  /** 스킬은 디렉터리(단일 파일 스킬은 파일), 메모리는 저장소 파일의 절대 경로 */
  readonly path: string;
}

/** 원장 행 하나. LedgerEntry에 내부 열을 더한 것 */
export interface LedgerRecord {
  readonly seq: number;
  readonly entry: LedgerEntry;
  readonly status: LedgerStatus;
  readonly targetPath: string;
  readonly beforeManifest: BlobRef | null;
  readonly afterManifest: BlobRef | null;
  readonly requestId: string | null;
  readonly requestFingerprint: string | null;
  readonly indexChanged: boolean;
  readonly outcome: WriteOutcome | null;
}

export interface NewLedgerRecord {
  readonly ledgerId: string;
  readonly at: number;
  readonly actor: KnowledgeActor;
  readonly target: LedgerTargetRef;
  readonly op: LedgerOp;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly beforeManifest: BlobRef | null;
  readonly afterManifest: BlobRef | null;
  readonly requestId: string | undefined;
  readonly requestFingerprint?: string | undefined;
  readonly approvedBy: ApprovedBy | undefined;
  readonly evidence: ApprovalEvidence | undefined;
  readonly scan: ScanSummary;
  readonly reason: string | undefined;
  readonly proposalId: string | undefined;
  readonly rollbackOf: string | undefined;
  /** 이 쓰기를 한 turn에 untrusted 도구 결과를 읽었다. 생략하면 거짓이다 */
  readonly afterUntrusted?: boolean;
  readonly status: LedgerStatus;
  readonly indexChanged: boolean;
  readonly outcome: WriteOutcome | undefined;
}

function cell(row: SqlRow, column: string): SqlValue {
  const value = row[column];
  if (value === undefined) throw new Bug(`ledger.row_missing_column: ${column}`);
  return value;
}

export function textCell(row: SqlRow, column: string): string {
  const value = cell(row, column);
  if (typeof value !== "string") throw new Bug(`ledger.row_not_text: ${column}`);
  return value;
}

function textOrNull(row: SqlRow, column: string): string | null {
  const value = cell(row, column);
  if (value === null) return null;
  if (typeof value !== "string") throw new Bug(`ledger.row_not_text: ${column}`);
  return value;
}

export function intCell(row: SqlRow, column: string): number {
  const value = cell(row, column);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Bug(`ledger.row_not_int: ${column}`);
}

function decode<S extends TSchema>(
  schema: S,
  text: string,
  what: string,
): Result<Static<S>, KnowledgeFailure> {
  const json = parseJson(text);
  if (!json.ok) return err(failure("internal", `${what} is not JSON`, { cause: json.error }));
  const checked = parse(schema, json.value);
  if (!checked.ok)
    return err(failure("internal", `${what} is malformed`, { cause: checked.error }));
  return ok(checked.value);
}

function decodeOptional<S extends TSchema>(
  schema: S,
  text: string | null,
  what: string,
): Result<Static<S> | null, KnowledgeFailure> {
  if (text === null) return ok(null);
  return decode(schema, text, what);
}

function isApprovedBy(value: string | null): value is ApprovedBy {
  return value === "user" || value === "approval" || value === "evidence" || value === "policy";
}

function toRecord(row: SqlRow): Result<LedgerRecord, KnowledgeFailure> {
  const actor = decode(KnowledgeActorSchema, textCell(row, "actor"), "ledger actor");
  if (!actor.ok) return actor;
  const scan = decode(ScanSummarySchema, textCell(row, "scan"), "ledger scan");
  if (!scan.ok) return scan;
  const evidence = decodeOptional(
    ApprovalEvidenceSchema,
    textOrNull(row, "evidence"),
    "ledger evidence",
  );
  if (!evidence.ok) return evidence;
  const beforeManifest = decodeOptional(
    BlobRefSchema,
    textOrNull(row, "before_manifest"),
    "before manifest",
  );
  if (!beforeManifest.ok) return beforeManifest;
  const afterManifest = decodeOptional(
    BlobRefSchema,
    textOrNull(row, "after_manifest"),
    "after manifest",
  );
  if (!afterManifest.ok) return afterManifest;
  const outcome = decodeOptional(WriteOutcomeSchema, textOrNull(row, "outcome"), "ledger outcome");
  if (!outcome.ok) return outcome;

  const kind = textCell(row, "target_kind");
  const scopeText = textOrNull(row, "target_scope");
  const scope = scopeText === "user" || scopeText === "project" ? scopeText : undefined;
  const status = textCell(row, "status");
  if (kind !== "skill" && kind !== "memory") {
    return err(failure("internal", "ledger target kind is unknown"));
  }
  if (status !== "prepared" && status !== "applied" && status !== "aborted") {
    return err(failure("internal", "ledger status is unknown"));
  }
  const op = parse(LedgerOpSchema, textCell(row, "op"));
  if (!op.ok) return err(failure("internal", "ledger op is unknown", { cause: op.error }));
  const approvedByText = textOrNull(row, "approved_by");
  const reason = textOrNull(row, "reason");
  const proposalId = textOrNull(row, "proposal_id");
  const rollbackOf = textOrNull(row, "rollback_of");
  const rolledBackBy = textOrNull(row, "rolled_back_by");
  const entry: LedgerEntry = {
    ledgerId: textCell(row, "ledger_id"),
    at: intCell(row, "at"),
    actor: actor.value,
    target: { kind, name: textCell(row, "target_name"), ...(scope === undefined ? {} : { scope }) },
    op: op.value,
    beforeHash: textOrNull(row, "before_hash"),
    afterHash: textOrNull(row, "after_hash"),
    ...(isApprovedBy(approvedByText) ? { approvedBy: approvedByText } : {}),
    ...(evidence.value === null ? {} : { evidence: evidence.value }),
    scan: scan.value,
    ...(reason === null ? {} : { reason }),
    ...(proposalId === null ? {} : { proposalId }),
    ...(rollbackOf === null ? {} : { rollbackOf }),
    ...(rolledBackBy === null ? {} : { rolledBackBy }),
    ...(intCell(row, "after_untrusted") === 1 ? { afterUntrusted: true } : {}),
  };
  return ok({
    seq: intCell(row, "seq"),
    entry,
    status,
    targetPath: textCell(row, "target_path"),
    beforeManifest: beforeManifest.value,
    afterManifest: afterManifest.value,
    requestId: textOrNull(row, "request_id"),
    requestFingerprint: textOrNull(row, "request_fp"),
    indexChanged: intCell(row, "index_changed") === 1,
    outcome: outcome.value,
  });
}

const json = (value: unknown): string => JSON.stringify(value);

/** 새 행을 넣는다. status는 prepared(쓰기 전 의도) 또는 applied(바깥 편집 기록처럼 이미 일어난 일) */
export function insertRecord(tx: SqlTx, record: NewLedgerRecord): void {
  tx.run(
    `INSERT INTO cap_knowledge_ledger (
       ledger_id, at, actor, target_kind, target_name, target_scope, target_path, op, status,
       before_hash, after_hash, before_manifest, after_manifest, request_id, approved_by, evidence,
       scan, reason, proposal_id, rollback_of, index_changed, outcome, after_untrusted, request_fp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.ledgerId,
      record.at,
      json(record.actor),
      record.target.kind,
      record.target.name,
      record.target.scope ?? null,
      record.target.path,
      record.op,
      record.status,
      record.beforeHash,
      record.afterHash,
      record.beforeManifest === null ? null : json(record.beforeManifest),
      record.afterManifest === null ? null : json(record.afterManifest),
      record.requestId ?? null,
      record.approvedBy ?? null,
      record.evidence === undefined ? null : json(record.evidence),
      json(record.scan),
      record.reason ?? null,
      record.proposalId ?? null,
      record.rollbackOf ?? null,
      record.indexChanged ? 1 : 0,
      record.outcome === undefined ? null : json(record.outcome),
      record.afterUntrusted === true ? 1 : 0,
      record.requestFingerprint ?? null,
    ],
  );
}

export function findByRequestId(
  tx: SqlTx,
  requestId: string,
): Result<LedgerRecord | undefined, KnowledgeFailure> {
  const row = tx.get("SELECT * FROM cap_knowledge_ledger WHERE request_id = ?", [requestId]);
  if (row === undefined) return ok(undefined);
  return toRecord(row);
}

export function findById(
  tx: SqlTx,
  ledgerId: string,
): Result<LedgerRecord | undefined, KnowledgeFailure> {
  const row = tx.get("SELECT * FROM cap_knowledge_ledger WHERE ledger_id = ?", [ledgerId]);
  if (row === undefined) return ok(undefined);
  return toRecord(row);
}

export function markApplied(
  tx: SqlTx,
  ledgerId: string,
  outcome: WriteOutcome,
  indexChanged: boolean,
): void {
  tx.run(
    "UPDATE cap_knowledge_ledger SET status = 'applied', outcome = ?, index_changed = ? WHERE ledger_id = ?",
    [json(outcome), indexChanged ? 1 : 0, ledgerId],
  );
}

/** 중단한 행. 같은 requestId로 다시 부를 수 있게 멱등 키를 비운다 */
export function markAborted(tx: SqlTx, ledgerId: string): void {
  tx.run(
    "UPDATE cap_knowledge_ledger SET status = 'aborted', request_id = NULL WHERE ledger_id = ?",
    [ledgerId],
  );
}

export function setRolledBackBy(tx: SqlTx, ledgerId: string, by: string): void {
  tx.run("UPDATE cap_knowledge_ledger SET rolled_back_by = ? WHERE ledger_id = ?", [by, ledgerId]);
}

export function preparedRecords(tx: SqlTx): Result<readonly LedgerRecord[], KnowledgeFailure> {
  const records: LedgerRecord[] = [];
  for (const row of tx.all(
    "SELECT * FROM cap_knowledge_ledger WHERE status = 'prepared' ORDER BY seq",
  )) {
    const record = toRecord(row);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

export interface LedgerQuery {
  readonly kind?: "skill" | "memory";
  readonly name?: string;
  readonly scope?: WritableSkillScope;
  readonly actorKind?: KnowledgeActor["kind"];
  /** 이 원장 항목보다 오래된 것만 */
  readonly beforeSeq?: number;
  readonly limit: number;
}

/** 적용된 항목을 최신순으로 */
export function listRecords(
  tx: SqlTx,
  query: LedgerQuery,
): Result<readonly LedgerRecord[], KnowledgeFailure> {
  const where: string[] = ["status = 'applied'"];
  const params: SqlValue[] = [];
  if (query.kind !== undefined) {
    where.push("target_kind = ?");
    params.push(query.kind);
  }
  if (query.name !== undefined) {
    where.push("target_name = ?");
    params.push(query.name);
  }
  if (query.scope !== undefined) {
    where.push("target_scope = ?");
    params.push(query.scope);
  }
  if (query.actorKind !== undefined) {
    where.push("json_extract(actor, '$.kind') = ?");
    params.push(query.actorKind);
  }
  if (query.beforeSeq !== undefined) {
    where.push("seq < ?");
    params.push(query.beforeSeq);
  }
  params.push(query.limit);
  const rows = tx.all(
    `SELECT * FROM cap_knowledge_ledger WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`,
    params,
  );
  const records: LedgerRecord[] = [];
  for (const row of rows) {
    const record = toRecord(row);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return ok(records);
}

/** 인덱스를 바꾼 적용 항목의 최대 seq. 스킬 인덱스 버전이다(spec §4.2.6) */
export function indexVersion(tx: SqlTx): number {
  const row = tx.get(
    "SELECT COALESCE(MAX(seq), 0) AS version FROM cap_knowledge_ledger WHERE status = 'applied' AND index_changed = 1",
  );
  return row === undefined ? 0 : intCell(row, "version");
}

/** 스킬을 처음 만든 항목의 행위자로 만든이를 정한다. 없으면 unknown */
export function createdByFromLedger(
  tx: SqlTx,
  name: string,
  scope: WritableSkillScope,
): "user" | "agent" | "unknown" {
  const row = tx.get(
    `SELECT json_extract(actor, '$.kind') AS kind FROM cap_knowledge_ledger
     WHERE target_kind = 'skill' AND target_name = ? AND target_scope = ? AND op = 'skill.create'
       AND status = 'applied' ORDER BY seq LIMIT 1`,
    [name, scope],
  );
  if (row === undefined) return "unknown";
  const kind = textOrNull(row, "kind");
  if (kind === "user") return "user";
  if (kind === "agent" || kind === "extension") return "agent";
  return "unknown";
}

/** 어떤 해시를 가졌던 내용의 목록 blob. 바깥 편집의 이전 내용을 찾는 데 쓴다 */
export function manifestForHash(
  tx: SqlTx,
  kind: "skill" | "memory",
  name: string,
  scope: WritableSkillScope | undefined,
  hash: string,
): BlobRef | null {
  const row = tx.get(
    `SELECT after_manifest AS manifest FROM cap_knowledge_ledger
     WHERE target_kind = ? AND target_name = ? AND target_scope IS ? AND after_hash = ?
       AND status = 'applied' AND after_manifest IS NOT NULL ORDER BY seq DESC LIMIT 1`,
    [kind, name, scope ?? null, hash],
  );
  if (row === undefined) return null;
  const text = textOrNull(row, "manifest");
  if (text === null) return null;
  const parsed = decode(BlobRefSchema, text, "manifest");
  return parsed.ok ? parsed.value : null;
}
