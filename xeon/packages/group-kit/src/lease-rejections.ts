import { parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { Unsubscribe } from "@xeon/contracts/extensions";
import {
  LeaseAcquiredPayloadSchema,
  LeaseRejectedPayloadSchema,
  LeaseReleasedPayloadSchema,
  ScopeChangedPayloadSchema,
  type EventFeed,
} from "@xeon/contracts/records";

/**
 * 대기 상한을 넘어 drive 임대를 거부당한 그룹의 기록(L3.group-kit.spec §3.8, plan G-30).
 * X는 거부된 scope를 다음 임대 반납이 커밋될 때까지 다시 세지 않는다(X.primitives.spec §4.4.1). 같은 규칙으로 지운다:
 * 그 thread의 `lease.released`, 그 그룹의 `lease.acquired`, 그 그룹의 `scope.changed`(켜기·끄기).
 * 프로세스 메모리에만 두므로 재시작하면 비고, X가 대기를 다시 세어 거부를 다시 낸다.
 */
export interface LeaseRejections {
  /** 이 thread에서 이 그룹이 거부된 상태인가 */
  has(threadId: ThreadId, groupId: string): boolean;
  /** 피드를 구독한다. 상태가 바뀌면 changed를 부른다. 같은 피드를 다시 넘기면 아무것도 하지 않는다 */
  attach(feed: EventFeed, changed: () => void): void;
  detach(): void;
}

export function createLeaseRejections(): LeaseRejections {
  const rejected = new Map<ThreadId, Set<string>>();
  let attached: EventFeed | undefined;
  let unsubscribe: Unsubscribe | undefined;

  function drop(threadId: ThreadId, groupId: string | undefined): boolean {
    const groups = rejected.get(threadId);
    if (groups === undefined) return false;
    if (groupId === undefined) {
      rejected.delete(threadId);
      return groups.size > 0;
    }
    const had = groups.delete(groupId);
    if (groups.size === 0) rejected.delete(threadId);
    return had;
  }

  function dropGroup(groupId: string): boolean {
    let changed = false;
    for (const threadId of rejected.keys()) {
      changed = drop(threadId, groupId) || changed;
    }
    return changed;
  }

  return {
    has: (threadId, groupId) => rejected.get(threadId)?.has(groupId) ?? false,
    attach(feed, changed) {
      if (attached === feed) return;
      unsubscribe?.();
      attached = feed;
      unsubscribe = feed.onCommit((batch) => {
        let touched = false;
        for (const event of batch.events) {
          if (event.kind === "lease.rejected") {
            const payload = parse(LeaseRejectedPayloadSchema, event.payload);
            if (!payload.ok) continue;
            const groups = rejected.get(event.threadId) ?? new Set<string>();
            groups.add(payload.value.groupId);
            rejected.set(event.threadId, groups);
            touched = true;
          } else if (event.kind === "lease.released") {
            const payload = parse(LeaseReleasedPayloadSchema, event.payload);
            if (payload.ok) touched = drop(event.threadId, undefined) || touched;
          } else if (event.kind === "lease.acquired") {
            const payload = parse(LeaseAcquiredPayloadSchema, event.payload);
            if (payload.ok) touched = drop(event.threadId, payload.value.scopeId) || touched;
          } else if (event.kind === "scope.changed") {
            const payload = parse(ScopeChangedPayloadSchema, event.payload);
            if (payload.ok) touched = dropGroup(payload.value.scopeId) || touched;
          }
        }
        if (touched) changed();
      });
    },
    detach() {
      unsubscribe?.();
      unsubscribe = undefined;
      attached = undefined;
    },
  };
}
