import type { Logger, Result } from "@xeon/contracts";
import type { KnowledgeFailure } from "./errors.ts";
import { diffIndex, formatIndexDelta, isEmptyDelta, type IndexSnapshot } from "./skills/delta.ts";
import type { SkillIndexBlock } from "./skills/prompt-block.ts";

// L2.knowledge.spec §4.2.5, §4.2.6, §4.3.4, §7: 세션별 프롬프트 맥락. 첫 turn에는 스킬 인덱스 블록과 메모리 스냅샷을
// 기록 메시지 하나로 더하고, 이후 turn에는 인덱스가 바뀌었을 때만 델타 메모 하나를 더한다. 시스템 프롬프트와 첫 블록은
// 건드리지 않는다(프롬프트 캐시 접두).

export const INDEX_MESSAGE_TYPE = "knowledge.context";
export const DELTA_MESSAGE_TYPE = "knowledge.index-delta";

interface ContextMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: false;
}

export interface TurnContextDeps {
  readonly skills: {
    indexBlock(threadId: string): Result<SkillIndexBlock, KnowledgeFailure>;
    indexSnapshot(threadId: string): Result<IndexSnapshot, KnowledgeFailure>;
    reindex(threadId?: string): Promise<Result<unknown, KnowledgeFailure>>;
    /** 색인이 이 대화의 작업 폴더를 따르게 한다. 폴더가 그대로면 아무것도 하지 않는다 */
    syncFor(threadId: string): Promise<Result<void, KnowledgeFailure>>;
  };
  readonly memory: {
    snapshotBlock(threadId: string): Promise<Result<string, KnowledgeFailure>>;
  };
  readonly logger: Logger;
}

type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export interface TurnContext {
  /** 세션 시작. 처음 시작하는 세션(`startup`, `new`)만 첫 turn에 블록을 넣는다 */
  start(threadId: string, reason: SessionStartReason): Promise<void>;
  /** turn 시작. 더할 메시지가 없으면 undefined */
  beforeAgentStart(threadId: string): Promise<ContextMessage | undefined>;
  /**
   * 컴팩션이 끝났다(`session_compact`). 컴팩션은 앞쪽 기록을 요약으로 바꾸므로 첫 turn에 넣었던 스킬 인덱스 블록과 메모리 스냅샷이
   * 모델 입력에서 사라진다. 이 대화의 다음 turn을 처음 turn처럼 다루어, 그때의 인덱스와 메모리로 블록을 다시 넣는다(C-11)
   */
  afterCompaction(threadId: string): void;
  /** 세션 정리 */
  shutdown(threadId: string): void;
  /** 추적 중인 세션 수(시험용) */
  size(): number;
}

function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter((block) => block !== "").join("\n\n");
}

export function createTurnContext(deps: TurnContextDeps): TurnContext {
  // 세션별로 마지막으로 모델에게 알린 인덱스. 항목이 있으면 첫 turn 블록을 이미 넣었다(재개한 세션은 기록에 있다고 본다)
  const states = new Map<string, IndexSnapshot>();

  const warn = (event: string, threadId: string, failure: KnowledgeFailure): void => {
    deps.logger.warn(event, { threadId, kind: failure.kind, message: failure.message });
  };

  const introduce = async (threadId: string): Promise<ContextMessage | undefined> => {
    // 스냅샷과 블록은 같은 시점의 인덱스에서 만든다(둘 사이에 await가 없다)
    const snapshot = deps.skills.indexSnapshot(threadId);
    if (!snapshot.ok) {
      warn("knowledge.context.index_failed", threadId, snapshot.error);
      return undefined;
    }
    const block = deps.skills.indexBlock(threadId);
    const memory = await deps.memory.snapshotBlock(threadId);
    if (!block.ok) warn("knowledge.context.index_failed", threadId, block.error);
    if (!memory.ok) warn("knowledge.context.memory_failed", threadId, memory.error);
    states.set(threadId, snapshot.value);
    const text = joinBlocks([block.ok ? block.value.text : "", memory.ok ? memory.value : ""]);
    return text === ""
      ? undefined
      : { customType: INDEX_MESSAGE_TYPE, content: text, display: false };
  };

  const delta = (threadId: string, state: IndexSnapshot): ContextMessage | undefined => {
    const current = deps.skills.indexSnapshot(threadId);
    if (!current.ok) {
      warn("knowledge.context.index_failed", threadId, current.error);
      return undefined;
    }
    if (current.value.version === state.version) return undefined;
    // 본문만 바뀐 변경은 버전이 같아 여기까지 오지 않거나, 델타가 비어 알리지 않는다
    states.set(threadId, current.value);
    const changes = diffIndex(state, current.value);
    if (isEmptyDelta(changes)) return undefined;
    return { customType: DELTA_MESSAGE_TYPE, content: formatIndexDelta(changes), display: false };
  };

  return {
    start: async (threadId, reason) => {
      // 바깥에서 둔 스킬을 이 세션이 보게 한다. 시작 시 재색인은 `startup`이 이미 했다(spec §7)
      if (reason !== "startup") {
        const refreshed = await deps.skills.reindex(threadId);
        if (!refreshed.ok) warn("knowledge.context.reindex_failed", threadId, refreshed.error);
      } else {
        // 시작 때 재색인은 대화를 모르고 했다. 이 대화의 작업 폴더로 맞춘다
        const synced = await deps.skills.syncFor(threadId);
        if (!synced.ok) warn("knowledge.context.reindex_failed", threadId, synced.error);
      }
      const fresh = reason === "startup" || reason === "new";
      if (fresh) {
        states.delete(threadId);
        return;
      }
      const snapshot = deps.skills.indexSnapshot(threadId);
      if (!snapshot.ok) {
        warn("knowledge.context.index_failed", threadId, snapshot.error);
        states.delete(threadId);
        return;
      }
      states.set(threadId, snapshot.value);
    },
    beforeAgentStart: async (threadId) => {
      const synced = await deps.skills.syncFor(threadId);
      if (!synced.ok) warn("knowledge.context.reindex_failed", threadId, synced.error);
      const state = states.get(threadId);
      if (state === undefined) return introduce(threadId);
      return delta(threadId, state);
    },
    afterCompaction: (threadId) => {
      states.delete(threadId);
    },
    shutdown: (threadId) => {
      states.delete(threadId);
    },
    size: () => states.size,
  };
}
