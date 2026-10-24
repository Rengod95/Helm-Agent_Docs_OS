import { canonicalJson, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  DurableEventEnvelopeSchema,
  type DurableEventEnvelope,
  type SqlRow,
  type SqlTx,
} from "@xeon/contracts/records";
import { columns, rowInvalid, type RowFault } from "./rows.ts";

/** events.envelope 열을 envelope로 되돌린다. 저장된 값이 스키마와 다르면 손상된 행이라 row_invalid다 */
function parseEnvelope(text: string): Result<DurableEventEnvelope, RowFault> {
  const json = parseJson(text);
  if (!json.ok) return err(rowInvalid("events.envelope"));
  const parsed = parse(DurableEventEnvelopeSchema, json.value);
  return parsed.ok ? parsed : err(rowInvalid("events.envelope"));
}

/** events 행의 envelope 열을 envelope로 되돌린다 */
export function envelopeOfRow(row: SqlRow): Result<DurableEventEnvelope, RowFault> {
  const text = columns(row, "events").string("envelope");
  return text.ok ? parseEnvelope(text.value) : text;
}

export function insertEvent(
  tx: SqlTx,
  envelope: DurableEventEnvelope,
  requestId: string,
  privateOwner: string | null,
): void {
  tx.run(
    `INSERT INTO events (seq, id, thread_id, parent_id, kind, version, turn_id, step_id, recorded_at,
       request_id, private_owner, envelope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      envelope.seq,
      envelope.id,
      envelope.threadId,
      envelope.parentId,
      envelope.kind,
      envelope.version,
      envelope.turnId,
      envelope.stepId,
      envelope.recordedAt,
      requestId,
      privateOwner,
      canonicalJson(envelope),
    ],
  );
}

export function envelopeAtSeq(
  tx: SqlTx,
  seq: number,
): Result<DurableEventEnvelope | undefined, RowFault> {
  const row = tx.get("SELECT envelope FROM events WHERE seq = ?", [seq]);
  return row === undefined ? ok(undefined) : envelopeOfRow(row);
}

/** DB 전역 head seq. event_seq.next_seq - 1(지운 thread의 seq도 되쓰지 않는다) */
export function headSeqOf(tx: SqlTx): Result<number, RowFault> {
  const row = tx.get("SELECT next_seq FROM event_seq WHERE singleton = 1");
  if (row === undefined) return err(rowInvalid("event_seq"));
  const next = columns(row, "event_seq").int("next_seq");
  return next.ok ? ok(next.value - 1) : next;
}
