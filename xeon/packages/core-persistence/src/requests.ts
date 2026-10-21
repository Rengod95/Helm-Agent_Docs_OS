import { Bug } from "@xeon/contracts";
import type { CommitResult, EventId, SqlRow, SqlTx } from "@xeon/contracts/records";
import { toEventId } from "./ids.ts";
import { parseJson } from "./events.ts";
import { columnString } from "./rows.ts";

/** 저장 결과. replayed는 저장하지 않는다(L1.persistence.spec §3.10) */
export type StoredResult = Exclude<CommitResult, { readonly status: "key_reused" }>;

export interface StoredRequest {
  readonly fingerprint: string;
  readonly result: StoredResult;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredResult(text: string): StoredResult {
  const raw = parseJson(text);
  if (!isRecord(raw)) throw new Bug("store.row_invalid: requests.result is not an object");
  if (raw["status"] === "committed") {
    const { firstSeq, lastSeq, leaf, eventIds } = raw;
    if (
      typeof firstSeq !== "number" ||
      typeof lastSeq !== "number" ||
      !(leaf === null || typeof leaf === "string") ||
      !Array.isArray(eventIds)
    ) {
      throw new Bug("store.row_invalid: requests.result committed shape");
    }
    const items: readonly unknown[] = eventIds;
    const ids: EventId[] = [];
    for (const id of items) {
      if (typeof id !== "string") throw new Bug("store.row_invalid: requests.result eventIds");
      ids.push(toEventId(id));
    }
    return {
      status: "committed",
      firstSeq,
      lastSeq,
      leaf: leaf === null ? null : toEventId(leaf),
      eventIds: ids,
      replayed: false,
    };
  }
  if (raw["status"] === "rejected") {
    const { code, detail } = raw;
    if (typeof code !== "string" || !(detail === null || typeof detail === "string")) {
      throw new Bug("store.row_invalid: requests.result rejected shape");
    }
    return { status: "rejected", code, detail, replayed: false };
  }
  throw new Bug("store.row_invalid: requests.result status");
}

function storedFrom(row: SqlRow): StoredRequest {
  return {
    fingerprint: columnString(row, "fingerprint"),
    result: parseStoredResult(columnString(row, "result")),
  };
}

export function findRequest(
  tx: SqlTx,
  threadId: string,
  requestId: string,
): StoredRequest | undefined {
  const row = tx.get(
    "SELECT fingerprint, result FROM requests WHERE thread_id = ? AND request_id = ?",
    [threadId, requestId],
  );
  return row === undefined ? undefined : storedFrom(row);
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
