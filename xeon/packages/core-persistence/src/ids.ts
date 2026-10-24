import type { ThreadId } from "@xeon/contracts/conversation";

/** 세션 임대 자원 이름(L0.store.spec §3.1 resource) */
export function sessionResource(threadId: ThreadId): string {
  return `session:${threadId}`;
}
