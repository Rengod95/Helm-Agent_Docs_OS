import { assertNever, parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LIFECYCLE_POINTS,
  type LifecycleEventKind,
  type PortKey,
  type ScopeId,
} from "@xeon/contracts/extensions";
import {
  AgentSettledEventPayloadSchema,
  LeaseRejectedPayloadSchema,
  type DurableEventDraft,
  type EventFeed,
} from "@xeon/contracts/records";
import type { HostCore } from "./core.ts";
import { typedDispatch } from "./dispatch.ts";
import { eachInOrder } from "./sequence.ts";

/** 커밋된 이벤트 하나. 레코드를 커밋한 쪽(X의 경계 기여, L1의 위임 정착 커밋)이 커밋 뒤에 알린다 */
export type CommittedEvent = Pick<DurableEventDraft, "id" | "kind" | "payload">;

/**
 * 커밋 피드 포트(서비스 `xeon.session`의 `feed` 속성, 제공 core-persistence). 다른 층(core-agents)이 커밋하는 `agent.settled`는
 * X의 경계 기여가 아니라 이 피드의 `onCommit`으로만 볼 수 있다(M3-REQ-102)
 */
export const SessionFeedPortKey: PortKey<EventFeed> = { name: "xeon.session", member: "feed" };

export interface Lifecycle {
  /** 커밋 피드가 제공되어 있으면 구독한다(한 번). thread를 열 때 부른다. 돌려주는 함수가 구독을 해제한다 */
  attach(): void;
  detach(): void;
  /**
   * 커밋된 이벤트 가운데 `LIFECYCLE_POINTS`에 있는 kind의 수명주기 지점을 디스패치한다(ADR-0017 §3.6, M3-REQ-102·108).
   * 디스패치 키는 이벤트 id다. 지점을 발화하는 쪽은 반드시 커밋 뒤에 부른다. 끝나기를 기다린다
   */
  afterCommit(threadId: ThreadId, events: readonly CommittedEvent[]): Promise<void>;
}

function isLifecycleKind(kind: string): kind is LifecycleEventKind {
  return Object.keys(LIFECYCLE_POINTS).includes(kind);
}

/** `agent.settled`의 위임 주체가 scope나 drive이면 그 scope의 핸들러만 받는다 [제안: 소유 scope 거르기는 X, F.extensions.spec 지점 45행] */
function ownerScopeOf(
  owner: { readonly kind: string; readonly scopeId?: string } | undefined,
): ScopeId | undefined {
  if (owner === undefined || owner.kind === "tool") return undefined;
  return owner.scopeId;
}

/** 같은 이벤트가 경계 커밋 알림과 피드로 두 번 오면 한 번만 발화한다. 기억하는 id 수 */
const SEEN_MAX = 4096;

export function createLifecycle(core: HostCore): Lifecycle {
  const seen = new Set<string>();
  let unsubscribe: (() => void) | undefined;
  let attachedTo: EventFeed | undefined;

  function firstTime(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > SEEN_MAX) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    return true;
  }
  async function dispatchOne(threadId: ThreadId, event: CommittedEvent): Promise<void> {
    if (!isLifecycleKind(event.kind)) return;
    if (!firstTime(event.id)) return;
    const point = LIFECYCLE_POINTS[event.kind];
    switch (point) {
      case "lifecycle.agent.settled": {
        const payload = parse(AgentSettledEventPayloadSchema, event.payload);
        if (!payload.ok) {
          core.deps.report({
            level: "warning",
            code: "handler_failed",
            message: `agent.settled event ${event.id} does not match its schema; lifecycle point skipped`,
          });
          return;
        }
        const onlyScope = ownerScopeOf(payload.value.owner);
        await typedDispatch(core.dispatcher, point, payload.value, {
          threadId,
          dispatchKey: event.id,
          ...(onlyScope === undefined ? {} : { onlyScope }),
        });
        return;
      }
      case "lifecycle.lease.rejected": {
        const payload = parse(LeaseRejectedPayloadSchema, event.payload);
        if (!payload.ok) {
          core.deps.report({
            level: "warning",
            code: "handler_failed",
            message: `lease.rejected event ${event.id} does not match its schema; lifecycle point skipped`,
          });
          return;
        }
        await typedDispatch(core.dispatcher, point, payload.value, {
          threadId,
          dispatchKey: event.id,
        });
        return;
      }
      default:
        return assertNever(point, "LIFECYCLE_POINTS");
    }
  }
  return {
    attach() {
      const feed = core.ports.get(SessionFeedPortKey);
      if (feed === undefined || attachedTo === feed) return;
      unsubscribe?.();
      attachedTo = feed;
      unsubscribe = feed.onCommit((batch) => {
        const events = batch.events.filter((event) => isLifecycleKind(event.kind));
        const byThread = Map.groupBy(events, (event) => event.threadId);
        for (const [threadId, list] of byThread) {
          if (!core.threads.has(threadId)) continue;
          core.track(this.afterCommit(threadId, list));
        }
      });
    },
    detach() {
      unsubscribe?.();
      unsubscribe = undefined;
      attachedTo = undefined;
    },
    async afterCommit(threadId, events) {
      await eachInOrder(events, async (event) => {
        await dispatchOne(threadId, event);
        return "continue";
      });
    },
  };
}
