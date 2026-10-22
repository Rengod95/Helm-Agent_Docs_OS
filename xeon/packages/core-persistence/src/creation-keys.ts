import { ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SqlTx } from "@xeon/contracts/records";
import { columns, type RowFault } from "./rows.ts";

// 전역 thread 생성 멱등 키(L1.persistence.spec §4.10.1). requests는 thread 범위라 thread 밖 키를 받지 못한다

export function lookupCreationKey(tx: SqlTx, key: string): Result<ThreadId | undefined, RowFault> {
  const row = tx.get("SELECT thread_id FROM thread_creation_keys WHERE key = ?", [key]);
  if (row === undefined) return ok(undefined);
  return columns(row, "thread_creation_keys").id("thr", "thread_id");
}

export function insertCreationKey(tx: SqlTx, key: string, threadId: ThreadId): void {
  tx.run("INSERT INTO thread_creation_keys (key, thread_id) VALUES (?, ?)", [key, threadId]);
}
