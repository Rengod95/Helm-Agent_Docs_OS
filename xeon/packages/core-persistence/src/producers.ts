import { Bug } from "@xeon/contracts";
import {
  ownerOfKind,
  RECOVERY_SYNTHESIS_KINDS,
  type DraftInput,
  type DurableEventDraft,
  type ProducerHandle,
  type ProducerId,
  type StampedDraft,
} from "@xeon/contracts/records";
import type { KindCatalog } from "./upcast.ts";

/** 코어 영속성 생산자. 서비스가 내부에서 쓰므로 밖에서 받을 수 없다(store.producer_claimed) */
export const PERSISTENCE_PRODUCER: ProducerId = "core.persistence";

export interface ProducerRegistry {
  /** 플러그인 setup 중 한 번만. 같은 생산자를 두 번 받으면 Bug("store.producer_claimed") */
  claim(id: ProducerId): ProducerHandle;
  /** 서비스 내부 용도. 소유 장부에 올리지 않는다 */
  internal(id: ProducerId): ProducerHandle;
  /**
   * recover만 쓰는 kind 단위 예외(L1.persistence.spec §3.9). 합성 effect.result와 toolResult item.recorded의
   * 초안을 core.persistence 이름으로 낙인한다. 내용 조건(synthesized, isError)은 커밋 때 writer가 다시 본다
   */
  recoveryDraft(input: DraftInput): StampedDraft;
  /** 이 레지스트리의 ProducerHandle이 낙인한 초안인가. 위조된 초안을 writer가 막는 데 쓴다 */
  isStamped(value: object): value is StampedDraft;
  /** 낙인한 초안의 내용만 바꾼 사본(blob 분리)에 같은 생산자로 다시 낙인한다. 낙인하지 않은 값이면 Bug */
  restamp(original: StampedDraft, draft: DurableEventDraft): StampedDraft;
}

/** 컴팩션 커밋이 `thread.compacted`와 함께 덧붙이는 새 접두 system item의 생산자(L1.context.spec §4.6 5번) */
const COMPACTION_PREFIX_PRODUCER: ProducerId = "core.context";
const COMPACTION_PREFIX_KIND = "item.recorded";

/** 생산자가 공개 핸들로 초안을 낼 수 있는 kind인가: 접두 소유, 또는 컴팩션의 접두 system item 예외 */
function mayDraftKind(producer: ProducerId, kind: string): boolean {
  if (ownerOfKind(kind) === producer) return true;
  return producer === COMPACTION_PREFIX_PRODUCER && kind === COMPACTION_PREFIX_KIND;
}

/** 소유 확인: 생산자 id가 kind 접두를 소유하거나, core.context의 접두 item 예외, core.persistence의 합성 결과 예외 */
export function producerOwnsKind(producer: ProducerId, kind: string): boolean {
  if (mayDraftKind(producer, kind)) return true;
  return producer === PERSISTENCE_PRODUCER && RECOVERY_SYNTHESIS_KINDS.includes(kind);
}

export function createProducerRegistry(catalog: KindCatalog): ProducerRegistry {
  // 인스턴스마다 하나. 모듈 전역에 두지 않는다(AP-C-04)
  const stamped = new WeakSet<object>();
  const claimed = new Set<ProducerId>([PERSISTENCE_PRODUCER]);

  const isStamped = (value: object): value is StampedDraft => stamped.has(value);

  const stamp = (draft: DurableEventDraft, producer: ProducerId): StampedDraft => {
    const candidate = { draft, producer };
    stamped.add(candidate);
    if (!isStamped(candidate)) throw new Bug("store.producer_claimed: stamp registry lost a draft");
    return candidate;
  };

  const complete = (input: DraftInput): DurableEventDraft => {
    const entry = catalog.entryOf(input.kind);
    if (entry === undefined) {
      throw new Bug(`store.kind_unregistered: ${input.kind} is not in any catalog`);
    }
    if (!entry.durable) {
      throw new Bug(`store.schema_invalid: ${input.kind} is volatile and cannot be committed`);
    }
    if (entry.retired === true) {
      throw new Bug(`store.kind_retired: ${input.kind} is retired and is not written any more`);
    }
    return { ...input, durable: true, version: input.version ?? entry.version };
  };

  const handleFor = (producer: ProducerId): ProducerHandle => ({
    producer,
    draft(input: DraftInput): StampedDraft {
      // 합성 결과 예외는 여기서 열지 않는다. recoveryDraft만 core.persistence 이름으로 낙인한다
      if (!mayDraftKind(producer, input.kind)) {
        const owner = ownerOfKind(input.kind);
        throw new Bug(
          `store.prefix_not_owned: ${producer} cannot draft ${input.kind} (owner: ${owner ?? "nobody"})`,
        );
      }
      return stamp(complete(input), producer);
    },
  });

  return {
    claim(id: ProducerId): ProducerHandle {
      if (claimed.has(id)) throw new Bug(`store.producer_claimed: ${id} was already claimed`);
      claimed.add(id);
      return handleFor(id);
    },
    internal: handleFor,
    recoveryDraft(input: DraftInput): StampedDraft {
      if (!RECOVERY_SYNTHESIS_KINDS.includes(input.kind)) {
        throw new Bug(`store.prefix_not_owned: ${input.kind} is not a recovery synthesis kind`);
      }
      return stamp(complete(input), PERSISTENCE_PRODUCER);
    },
    isStamped,
    restamp(original: StampedDraft, draft: DurableEventDraft): StampedDraft {
      if (!isStamped(original)) {
        throw new Bug("store.producer_claimed: restamp needs a draft stamped by this registry");
      }
      return stamp(draft, original.producer);
    },
  };
}
