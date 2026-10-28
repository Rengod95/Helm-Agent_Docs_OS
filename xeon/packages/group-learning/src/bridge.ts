import type { Result } from "@xeon/contracts";
import type { LearningError } from "./results.ts";
import type { ProposalView } from "./proposals/proposal.ts";
import type { ProposalFilter } from "./proposals/reader.ts";

// L4 승인 화면 계약(§3.8)의 TS 면. 학습 그룹은 서비스를 제공하지 않는다(eng.context-map.design 협력 규칙 7). 조립 루트가 이 자리를 만들어 그룹에 넘기고,
// 그룹이 켜져 있는 동안만 `api()`가 값을 낸다. 꺼졌거나(안전 모드 포함) 아직 켜지 않았으면 undefined다. 결정과 지연 정리는 기록을 쓰므로 대화(ambient)가 필요하다:
// 조립 루트가 `/learning` 명령을 그 대화에서 실행한다(`decisionCommandLine`).

export interface LearningQueueApi {
  /** 대기열 목록(투영 읽기). 최신순 */
  list(filter: ProposalFilter): Promise<Result<readonly ProposalView[], LearningError>>;
}

export interface LearningBridge {
  /** 그룹이 켜져 있으면 대기열 면, 아니면 undefined */
  api(): LearningQueueApi | undefined;
  /** 그룹이 setup에서 부른다. 돌려받은 함수가 연결을 푼다 */
  attach(api: LearningQueueApi): () => void;
}

export function createLearningBridge(): LearningBridge {
  let current: LearningQueueApi | undefined;
  return {
    api: () => current,
    attach(api) {
      current = api;
      return () => {
        if (current === api) current = undefined;
      };
    },
  };
}
