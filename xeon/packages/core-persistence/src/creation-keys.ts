import type { ThreadId } from "@xeon/contracts/conversation";
import type { SqlTx } from "@xeon/contracts/records";
import { toThreadId } from "./ids.ts";
import { columnString } from "./rows.ts";

// 전역 thread 생성 멱등 키(L1.persistence.spec §4.10.1). requests는 thread 범위라 thread 밖 키를 받지 못한다

export function lookupCreationKey(tx: SqlTx, key: string): ThreadId | undefined {
  const row = tx.get("SELECT thread_id FROM thread_creation_keys WHERE key = ?", [key]);
  return row === undefined ? undefined : toThreadId(columnString(row, "thread_id"));
}

export function insertCreationKey(tx: SqlTx, key: string, threadId: ThreadId): void {
  tx.run("INSERT INTO thread_creation_keys (key, thread_id) VALUES (?, ?)", [key, threadId]);
}
