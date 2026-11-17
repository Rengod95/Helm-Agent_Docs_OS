// 서브에이전트 앞뒤 훅의 대역(AgentsHooks). 호출을 기록하고, 다음 결정과 보고 고치기를 시험이 정한다.
// 호출 때의 관측값(`observed`)은 자식이 만들어지기 전인지 확인하는 데 쓴다.
import type {
  AgentSpawnAfterPayload,
  AgentSpawnAfterValue,
  AgentSpawnBeforeDecision,
  AgentSpawnBeforePayload,
} from "@fresnel/contracts/extensions";
import type { AgentsHooks } from "../../src/index.ts";

/** 호출 시점의 대화 수 관측. 자식 thread 수와 `agent.spawned`·`agent.settled` 수를 본다 */
export interface Observed {
  readonly threads: number;
  readonly spawned: number;
  readonly settled: number;
}

interface BeforeCall {
  readonly payload: AgentSpawnBeforePayload;
  readonly dispatchKey: string;
  readonly observed: Observed;
}

interface AfterCall {
  readonly payload: AgentSpawnAfterPayload;
  readonly initial: AgentSpawnAfterValue;
  readonly observed: Observed;
}

export interface FakeHooks extends AgentsHooks {
  readonly before: readonly BeforeCall[];
  readonly after: readonly AfterCall[];
  /** 다음 앞 훅의 결정과 결정한 확장(없으면 undefined와 null). 기본은 결정 없음 */
  decideBefore(decision: AgentSpawnBeforeDecision | undefined, extension?: string): void;
  /** 앞 훅 디스패치가 실패한다(핸들러 예외가 디스패처 밖으로 나온 것) */
  failBefore(): void;
  /** 뒤 훅이 보고 본문을 이 함수로 고친다 */
  patchAfter(patch: (text: string) => string): void;
  /** 뒤 훅 디스패치가 실패한다(보고는 그대로 남는다) */
  failAfter(): void;
}

export function fakeHooks(observe: () => Observed): FakeHooks {
  const before: BeforeCall[] = [];
  const after: AfterCall[] = [];
  let decision: AgentSpawnBeforeDecision | undefined;
  let extension: string | null = null;
  let beforeFails = false;
  let afterFails = false;
  let patch: ((text: string) => string) | undefined;
  return {
    before,
    after,
    decideBefore(next, name) {
      decision = next;
      extension = name ?? null;
    },
    failBefore() {
      beforeFails = true;
    },
    patchAfter(next) {
      patch = next;
    },
    failAfter() {
      afterFails = true;
    },
    spawnBefore(input) {
      before.push({ payload: input.payload, dispatchKey: input.dispatchKey, observed: observe() });
      if (beforeFails) return Promise.reject(new Error("handler exploded"));
      return Promise.resolve({ decision, extension });
    },
    spawnAfter(input) {
      after.push({ payload: input.payload, initial: input.initial, observed: observe() });
      if (afterFails) return Promise.reject(new Error("handler exploded"));
      const text =
        patch === undefined ? input.initial.report.text : patch(input.initial.report.text);
      return Promise.resolve({ report: { text, truncated: input.initial.report.truncated } });
    },
  };
}
