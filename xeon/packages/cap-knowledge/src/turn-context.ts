import { attemptAsync, type Logger, type Result } from "@fresnel/contracts";
import type { KnowledgeFailure } from "./errors.ts";
import { diffIndex, formatIndexDelta, isEmptyDelta, type IndexSnapshot } from "./skills/delta.ts";
import type { SkillIndexBlock } from "./skills/prompt-block.ts";

// L2.knowledge.spec §4.2.5, §4.2.6, §4.3.4, §7: 세션별 프롬프트 맥락. 첫 turn에는 스킬 인덱스 블록과 메모리 스냅샷을
// 기록 메시지 하나로 더하고, 이후 turn에는 인덱스가 바뀌었을 때만 델타 메모 하나를 더한다. 시스템 프롬프트와 첫 블록은
// 건드리지 않는다(프롬프트 캐시 접두). 컴팩션 뒤에 이 메시지를 모델 입력에 다시 놓는 일은 L1.context가 한다(L1.context.spec §4.9a):
// 이 패키지는 컴팩션을 보지 않고 세션별 상태를 그대로 둔다(L2.knowledge.spec §4.2.8).

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
  /**
   * turn 시작이 시작 작업과 재색인을 기다리는 최대 시간(ms). hook 체인 예산(10초)보다 짧아야 한다: 예산을 넘기면 체인이 turn의
   * 블록을 버리는데 상태에는 기록되어 그 대화가 스킬 목록을 못 받는다. 기본 5000
   */
  readonly waitMs?: number;
}

type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export interface TurnContext {
  /** 세션 시작. 처음 시작하는 세션(`startup`, `new`)만 첫 turn에 블록을 넣는다 */
  start(threadId: string, reason: SessionStartReason): Promise<void>;
  /** turn 시작. 이 대화의 시작이 진행 중이면 끝날 때까지 기다린 뒤 답한다. 더할 메시지가 없으면 undefined */
  beforeAgentStart(threadId: string): Promise<ContextMessage | undefined>;
  /** 세션 정리. 진행 중인 시작도 잊는다 */
  shutdown(threadId: string): void;
  /** 추적 중인 세션 수(시험용) */
  size(): number;
}

function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter((block) => block !== "").join("\n\n");
}

const DEFAULT_WAIT_MS = 5000;

/** `work`가 `ms` 안에 끝나면 true, 아니면 false. 늦게 끝나는 작업은 그대로 둔다(결과를 쓰지 않는다) */
async function withDeadline(ms: number, work: () => Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const finished = (async (): Promise<boolean> => {
    await work();
    return true;
  })();
  try {
    return await Promise.race([finished, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export function createTurnContext(deps: TurnContextDeps): TurnContext {
  const waitMs = deps.waitMs ?? DEFAULT_WAIT_MS;
  // 세션별로 마지막으로 모델에게 알린 인덱스. 항목이 있으면 첫 turn 블록을 이미 넣었다(재개한 세션은 기록에 있다고 본다)
  const states = new Map<string, IndexSnapshot>();
  // 시작이 진행 중인 세션의 시작 작업. 거부가 없는 값이다. turn은 이것이 끝난 뒤에 상태를 읽는다
  const starting = new Map<string, Promise<unknown>>();

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

  const startSession = async (threadId: string, reason: SessionStartReason): Promise<void> => {
    // 바깥에서 둔 스킬을 이 세션이 보게 한다. 시작 시 재색인은 `startup`이 이미 했다(spec §7)
    if (reason !== "startup") {
      const refreshed = await deps.skills.reindex(threadId);
      if (!refreshed.ok) warn("knowledge.context.reindex_failed", threadId, refreshed.error);
    } else {
      // 시작 때 재색인은 대화를 모르고 했다. 이 대화의 작업 폴더로 맞춘다
      const synced = await deps.skills.syncFor(threadId);
      if (!synced.ok) warn("knowledge.context.reindex_failed", threadId, synced.error);
    }
    // 처음 시작하는 세션은 기록에 블록이 없어서 상태도 없어야 한다. 그래서 지우지 않고 돌아간다. 지우면 안 된다: 재색인이 끝나기 전에
    // 첫 turn이 블록을 넣었을 수 있고, 그 뒤에 지우면 다음 turn이 같은 블록을 한 번 더 넣는다.
    const fresh = reason === "startup" || reason === "new";
    if (fresh) return;
    const snapshot = deps.skills.indexSnapshot(threadId);
    if (!snapshot.ok) {
      warn("knowledge.context.index_failed", threadId, snapshot.error);
      states.delete(threadId);
      return;
    }
    states.set(threadId, snapshot.value);
  };

  // 시작 하나를 진행 중 목록에 넣는다. 등록은 이 함수를 부르는 즉시 일어나므로, 그 뒤에 온 turn은 이 시작을 기다린다.
  // 목록에는 거부가 없는 값을 넣고, 거부는 돌려주는 값으로 호출자에게 간다. 끝나면 목록에서 뺀다(다른 시작이 넣은 것은 건드리지 않는다)
  const track = async (threadId: string, work: Promise<void>): Promise<void> => {
    const settled = attemptAsync(() => work);
    starting.set(threadId, settled);
    try {
      await work;
    } finally {
      if (starting.get(threadId) === settled) starting.delete(threadId);
    }
  };

  return {
    start: (threadId, reason) => track(threadId, startSession(threadId, reason)),
    beforeAgentStart: async (threadId) => {
      // 시작은 턴을 기다리지 않는다(재색인은 파일과 DB만 읽고 쓰고, turn을 기다리는 호출이 없다). 그래서 턴이 시작을 기다려도 교착이 없다.
      // 기다림은 `waitMs`로 끊는다. 끊으면 이번 turn은 아무것도 더하지 않고 상태도 건드리지 않아, 다음 turn이 블록을 다시 시도한다
      const settled = await withDeadline(waitMs, async () => {
        const pending = starting.get(threadId);
        if (pending !== undefined) await pending;
        // 대화 중에 둔 스킬과 그 사이에 준 신뢰를 이번 turn이 보게 한다. 작업 폴더가 그대로여도 매 turn 다시 훑는다
        const refreshed = await deps.skills.reindex(threadId);
        if (!refreshed.ok) warn("knowledge.context.reindex_failed", threadId, refreshed.error);
      });
      if (!settled) {
        deps.logger.warn("knowledge.context.reindex_timeout", { threadId, waitMs });
        return undefined;
      }
      const state = states.get(threadId);
      if (state === undefined) return introduce(threadId);
      return delta(threadId, state);
    },
    shutdown: (threadId) => {
      states.delete(threadId);
      starting.delete(threadId);
    },
    size: () => states.size,
  };
}
