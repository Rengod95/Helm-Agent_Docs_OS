import { Bug, canonicalJson, parse } from "@xeon/contracts";
import {
  DurableEventEnvelopeSchema,
  type DurableEventEnvelope,
  type SqlTx,
} from "@xeon/contracts/records";
import { columnString } from "./rows.ts";

/** JSON 문자열을 unknown으로 읽는다. 호출자가 스키마로 좁힌다(TY-10) */
export function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/** events.envelope 열을 envelope로 되돌린다. 저장된 값이 스키마와 다르면 데이터가 깨진 것이라 Bug다 */
export function parseEnvelope(text: string): DurableEventEnvelope {
  const parsed = parse(DurableEventEnvelopeSchema, parseJson(text));
  if (!parsed.ok)
    throw new Bug("store.row_invalid: events.envelope is not an envelope", { cause: parsed.error });
  return parsed.value;
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

export function envelopeAtSeq(tx: SqlTx, seq: number): DurableEventEnvelope | undefined {
  const row = tx.get("SELECT envelope FROM events WHERE seq = ?", [seq]);
  return row === undefined ? undefined : parseEnvelope(columnString(row, "envelope"));
}

/** DB 전역 head seq. event_seq.next_seq - 1(지운 thread의 seq도 되쓰지 않는다) */
export function headSeqOf(tx: SqlTx): number {
  const row = tx.get("SELECT next_seq FROM event_seq WHERE singleton = 1");
  if (row === undefined) throw new Bug("store.row_invalid: event_seq has no row");
  const next = row["next_seq"];
  if (typeof next !== "number") throw new Bug("store.row_invalid: event_seq.next_seq");
  return next - 1;
}
