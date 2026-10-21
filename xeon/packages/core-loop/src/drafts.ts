import { Bug } from "@xeon/contracts";
import type { EventId, IdFactory, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  ownerOfKind,
  type DurableEventDraft,
  type EventKind,
  type ProducerHandle,
  type ProducerId,
  type SessionService,
  type StampedDraft,
} from "@xeon/contracts/records";

/** 이벤트 초안의 범위 필드. envelope 범위 필드와 같은 이름이다 */
export interface DraftScope {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
}

/**
 * 초안 낙인기. `core.loop` 생산자로 만드는 초안과, 경계에서 받은 외부 초안(확장 엔트리, X 기여)을
 * kind 소유자 생산자로 낙인한다(L1.persistence.spec §3.2, eng.context-map.design §5.1).
 */
export interface Drafter {
  /** `core.loop`가 소유한 kind의 초안을 만든다. 소유하지 않은 kind면 저장소가 Bug("store.prefix_not_owned")를 던진다 */
  make(
    kind: EventKind,
    payload: unknown,
    scope: DraftScope,
    options?: { readonly causationId?: EventId },
  ): StampedDraft;
  /** 이미 id가 있는 외부 초안(boundary 엔트리, X 경계 기여)을 kind 소유자 생산자로 낙인한다 */
  stamp(draft: DurableEventDraft): StampedDraft;
}

function isCore(owner: string): owner is ProducerId {
  return (
    owner === "core.persistence" ||
    owner === "core.tasks" ||
    owner === "core.loop" ||
    owner === "core.context" ||
    owner === "core.tools" ||
    owner === "core.agents" ||
    owner === "core.models"
  );
}

function isCap(owner: string): owner is `cap.${string}` {
  return owner.startsWith("cap.");
}

function isExt(owner: string): owner is `ext.${string}` {
  return owner.startsWith("ext.");
}

function toProducerId(owner: string): ProducerId | undefined {
  if (owner === "xh") return "xh";
  if (isCore(owner) || isCap(owner) || isExt(owner)) return owner;
  return undefined;
}

export function createDrafter(deps: {
  readonly session: Pick<SessionService, "producer">;
  readonly ids: IdFactory;
}): Drafter {
  const loop = deps.session.producer("core.loop");
  // 같은 생산자는 한 번만 받을 수 있다(store.producer_claimed). 처음 쓸 때 받아 둔다
  const handles = new Map<ProducerId, ProducerHandle>([["core.loop", loop]]);

  function handleFor(id: ProducerId): ProducerHandle {
    const known = handles.get(id);
    if (known !== undefined) return known;
    const claimed = deps.session.producer(id);
    handles.set(id, claimed);
    return claimed;
  }

  return {
    make(kind, payload, scope, options) {
      return loop.draft({
        id: deps.ids.next("evt"),
        kind,
        threadId: scope.threadId,
        turnId: scope.turnId,
        stepId: scope.stepId,
        causationId: options?.causationId ?? null,
        correlationId: scope.turnId,
        payload,
      });
    },
    stamp(draft) {
      const owner = ownerOfKind(draft.kind);
      const producer = owner === undefined ? undefined : toProducerId(owner);
      if (producer === undefined) {
        throw new Bug(`drafts.owner_unknown: ${draft.kind}`);
      }
      return handleFor(producer).draft({
        id: draft.id,
        kind: draft.kind,
        version: draft.version,
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepId: draft.stepId,
        causationId: draft.causationId,
        correlationId: draft.correlationId,
        payload: draft.payload,
        ...(draft.detached === undefined ? {} : { detached: draft.detached }),
        ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      });
    },
  };
}
