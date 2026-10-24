import { err, ok, parseJson, type Result } from "@xeon/contracts";
import { isId, type EventId } from "@xeon/contracts/conversation";
import type { CommitResult, SqlRow, SqlTx } from "@xeon/contracts/records";
import { columns, rowInvalid, type RowFault } from "./rows.ts";

/** 저장 결과. replayed는 저장하지 않는다(L1.persistence.spec §3.10) */
export type StoredResult = Exclude<CommitResult, { readonly status: "key_reused" }>;

export interface StoredRequest {
  readonly fingerprint: string;
  readonly result: StoredResult;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fault(what: string): Result<never, RowFault> {
  return err(rowInvalid(`requests.result ${what}`));
}

function parseStoredResult(text: string): Result<StoredResult, RowFault> {
  const json = parseJson(text);
  if (!json.ok) return fault("is not JSON");
  const raw = json.value;
  if (!isRecord(raw)) return fault("is not an object");
  if (raw["status"] === "committed") {
    const { firstSeq, lastSeq, leaf, eventIds } = raw;
    if (
      typeof firstSeq !== "number" ||
      typeof lastSeq !== "number" ||
      !(leaf === null || isId("evt", leaf)) ||
      !Array.isArray(eventIds)
    ) {
      return fault("committed shape");
    }
    const items: readonly unknown[] = eventIds;
    const ids: EventId[] = [];
    for (const id of items) {
      if (!isId("evt", id)) return fault("eventIds");
      ids.push(id);
    }
    return ok({ status: "committed", firstSeq, lastSeq, leaf, eventIds: ids, replayed: false });
  }
  if (raw["status"] === "rejected") {
    const { code, detail } = raw;
    if (typeof code !== "string" || !(detail === null || typeof detail === "string")) {
      return fault("rejected shape");
    }
    return ok({ status: "rejected", code, detail, replayed: false });
  }
  return fault("status");
}

function storedFrom(row: SqlRow): Result<StoredRequest, RowFault> {
  const c = columns(row, "requests");
  const fingerprint = c.string("fingerprint");
  if (!fingerprint.ok) return fingerprint;
  const text = c.string("result");
  if (!text.ok) return text;
  const result = parseStoredResult(text.value);
  if (!result.ok) return result;
  return ok({ fingerprint: fingerprint.value, result: result.value });
}

export function findRequest(
  tx: SqlTx,
  threadId: string,
  requestId: string,
): Result<StoredRequest | undefined, RowFault> {
  const row = tx.get(
    "SELECT fingerprint, result FROM requests WHERE thread_id = ? AND request_id = ?",
    [threadId, requestId],
  );
  return row === undefined ? ok(undefined) : storedFrom(row);
}

export function insertRequest(
  tx: SqlTx,
  threadId: string,
  requestId: string,
  fingerprint: string,
  result: StoredResult,
): void {
  const body =
    result.status === "committed"
      ? {
          status: result.status,
          firstSeq: result.firstSeq,
          lastSeq: result.lastSeq,
          leaf: result.leaf,
          eventIds: result.eventIds,
        }
      : { status: result.status, code: result.code, detail: result.detail };
  tx.run(
    `INSERT INTO requests (thread_id, request_id, fingerprint, status, result, first_seq, last_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      threadId,
      requestId,
      fingerprint,
      result.status,
      JSON.stringify(body),
      result.status === "committed" ? result.firstSeq : null,
      result.status === "committed" ? result.lastSeq : null,
    ],
  );
}
