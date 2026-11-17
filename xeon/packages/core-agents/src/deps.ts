import type { Logger } from "@fresnel/contracts";
import type { IdFactory, ThreadId } from "@fresnel/contracts/conversation";
import type {
  LeaseHolder,
  LeaseService,
  LeaseToken,
  ProducerHandle,
  SessionService,
} from "@fresnel/contracts/records";
import type {
  AgentSpawnAfterPayload,
  AgentSpawnAfterValue,
  AgentSpawnBeforeDecision,
  AgentSpawnBeforePayload,
} from "@fresnel/contracts/extensions";
import type {
  ApprovalService,
  InputQueue,
  LoopService,
  TaskService,
  ToolService,
} from "@fresnel/contracts/services";
import type { StructuredModels } from "./structured.ts";

// core-agents는 core-loop, core-tasks, core-tools, core-persistence를 import하지 않는다(DR-02). 협력은 F 서비스 타입의 부분형으로 받는다.

/** `agent.spawn.before`의 입력. 디스패치 키와 취소 신호를 함께 받는다 */
export interface AgentsSpawnBeforeInput {
  readonly payload: AgentSpawnBeforePayload;
  readonly dispatchKey: string;
  readonly signal: AbortSignal;
}

/** `agent.spawn.before`의 결과. 결정이 없으면 `decision`이 `undefined`다. `extension`은 결정한 확장(없으면 null) */
export interface AgentsSpawnBeforeOutcome {
  readonly decision: AgentSpawnBeforeDecision | undefined;
  readonly extension: string | null;
}

/** `agent.spawn.after`의 입력. 초기 값은 결과 검사를 거친 보고다 */
export interface AgentsSpawnAfterInput {
  readonly payload: AgentSpawnAfterPayload;
  readonly dispatchKey: string;
  readonly initial: AgentSpawnAfterValue;
}

/**
 * 서브에이전트 앞뒤 훅의 발화(M5e 스펙 §4.3.3, §4.3.4). 조립은 플러그인이 ext-host 디스패처에 잇는다(`plugin.ts`).
 * 디스패치 자체가 실패하면 두 메서드 모두 거부(reject)한다. 앞 훅은 거부로, 뒤 훅은 보고를 그대로 두는 것으로 받는다.
 */
export interface AgentsHooks {
  spawnBefore(input: AgentsSpawnBeforeInput): Promise<AgentsSpawnBeforeOutcome>;
  spawnAfter(input: AgentsSpawnAfterInput): Promise<AgentSpawnAfterValue>;
}

/** 이 패키지가 쓰는 SessionService의 부분 */
export type AgentsSession = Pick<
  SessionService,
  "commit" | "threads" | "query" | "hydrate" | "openForWrite" | "release"
>;

/** 자식 turn 실행. fresnel.loop는 core-loop 플러그인이 올리므로 호출 때마다 얻는다(적재 순서에 묶이지 않게) */
export type AgentsLoop = Pick<LoopService, "runChildTurn">;

export type AgentsTasks = Pick<TaskService, "openScope" | "find" | "abort" | "limiter" | "root"> & {
  /** 완료 보고 입력 초안(`agent.settled` 커밋 안에서 부른다) */
  readonly inputs: Pick<InputQueue, "draftQueued">;
};

export type AgentsTools = Pick<
  ToolService,
  "mode" | "setMode" | "advertise" | "register" | "registerRules" | "suspendWhile" | "checkSpawn"
>;

/** `l1.agents.*` 설정 읽기. 값을 정하는 쪽(효과 값 계산)은 조립 루트가 넘긴다. 호출 때마다 읽는다(nextTurn 키) */
export interface AgentsSettingsSource {
  /** l1.agents.maxDepth */
  maxDepth(): number;
  /** l1.agents.maxConcurrent: 소유 트리 루트 하나의 동시 자식 수 */
  maxConcurrent(): number;
  /** l1.agents.resultMaxChars */
  resultMaxChars(): number;
  /** l1.agents.judge.maxRuns. 없으면 3(명세 기본값). 세션 범위 값을 받는 키라 판정 대상 thread로 읽는다 */
  judgeMaxRuns?(threadId: ThreadId): number;
}

export interface StaticAgentsSettings {
  readonly maxDepth?: number;
  readonly maxConcurrent?: number;
  readonly resultMaxChars?: number;
  readonly judgeMaxRuns?: number;
}

/** 값이 정해진 설정 읽기. 없는 값은 명세 기본값(1, 8, 24000)이다 */
export function createStaticAgentsSettings(
  values: StaticAgentsSettings = {},
): AgentsSettingsSource {
  return {
    maxDepth: () => values.maxDepth ?? 1,
    maxConcurrent: () => values.maxConcurrent ?? 8,
    resultMaxChars: () => values.resultMaxChars ?? 24_000,
    judgeMaxRuns: () => values.judgeMaxRuns ?? 3,
  };
}

/**
 * 자식 thread의 쓰기 소유. 자식은 부모와 같은 엔진 인스턴스(holder)가 쓴다(L1.agents.spec §4.1 3번).
 * [미결] 부모 토큰과 holder는 조립 루트가 넘긴다: SpawnOrigin에 토큰이 없고 SessionService에 소유 토큰 조회가 없다(F 요청)
 */
export interface AgentsOwnership {
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰. 모르면 undefined */
  parentToken(threadId: ThreadId): LeaseToken | undefined;
  readonly holder: LeaseHolder;
  /** 재개 때 자식 임대를 다시 얻는 데 쓴다 */
  readonly leases: Pick<LeaseService, "acquire">;
}

export interface AgentsDeps {
  readonly session: AgentsSession;
  readonly loop: () => AgentsLoop;
  readonly tasks: AgentsTasks;
  readonly tools: AgentsTools;
  /** core.agents 생산자. 플러그인 setup에서 한 번 받는다 */
  readonly producer: ProducerHandle;
  /** 서브에이전트 앞뒤 훅 발화(`agent.spawn.before`, `agent.spawn.after`) */
  readonly hooks: AgentsHooks;
  /**
   * 승인 요청(`fresnel.approvals`의 `request`). 호출 때마다 얻는다. 없으면 훅의 묻기는 "확인 불가"로 거부한다.
   * 주 대화의 깊이 0 호출에서만 쓴다(E-4)
   */
  readonly approvals?: () => Pick<ApprovalService, "request"> | undefined;
  readonly ids: IdFactory;
  readonly settings: AgentsSettingsSource;
  readonly ownership: AgentsOwnership;
  readonly log: Logger;
  /** 판정이 부르는 fresnel.models. 호출 때마다 얻는다. 생략하거나 undefined를 돌려주면 판정은 `failed`다 */
  readonly models?: () => StructuredModels | undefined;
  /** 시각(ms). 판정 요청 메시지에 쓴다. 생략하면 Date.now */
  readonly now?: () => number;
}
