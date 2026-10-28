import type { SchemaProof } from "@xeon/contracts";
import type { StateDecl } from "@xeon/contracts/extensions";
import { Type } from "typebox";

// L3.learning.spec §3.2. scope 상태 문서. g.commit으로만 바꾼다.

export interface LearningState {
  /** 마지막 검토 이후 센 사용자 turn 수 */
  readonly userTurnsSinceReview: number;
  /** 마지막 스킬 쓰기(또는 검토) 이후 센 도구 반복 수 */
  readonly toolIterationsSinceSkillWrite: number;
  /** 마지막으로 시작한 검토의 requestId. 없으면 null */
  readonly lastReviewId: string | null;
  /** 마지막으로 시작한 검토의 순번. 0은 검토 이력 없음 */
  readonly epoch: number;
  /** 아직 agent.settled를 받지 못한 검토의 requestId. 한 대화에 하나만 둔다(§4.2 규칙 0) */
  readonly inFlightReviewId: string | null;
  /** 마지막으로 agent.settled를 받은 검토의 requestId. 자식이 §4.3의 4번 커밋보다 먼저 정착한 경우를 알아보는 표지다 */
  readonly settledReviewId: string | null;
  /**
   * 마지막으로 반영한 turn의 id [제안]. `boundary.settle.after`가 같은 turn으로 다시 발화하면(재개, 재생) 이미 반영한 것이므로 그대로 돌아간다.
   * 핸들러의 커밋이 이미 남은 뒤에 재발화하면 핸들러가 바뀐 상태를 읽어 다른 효과를 낼 수 있어서, 이 표지로 같은 turn의 두 번째 처리를 막는다(ADR-0015)
   */
  readonly lastTurnId: string | null;
  /** 마지막으로 정착한 turn의 마지막 item [제안]. 수동 검토(`/learning review`)의 포크 지점이다 */
  readonly lastItemId: string | null;
  /** 연속 위임 실패 수(§5 사례 7). 위임 성공 때 0 */
  readonly delegateFailures: number;
  /** 2차 큐레이터: 마지막 실행 시각(epoch ms). 1차에서는 null 고정 */
  readonly curatorLastRunAt: number | null;
}

const nullableId = Type.Union([Type.String({ maxLength: 48 }), Type.Null()]);

const shape = Type.Object(
  {
    userTurnsSinceReview: Type.Integer({ minimum: 0 }),
    toolIterationsSinceSkillWrite: Type.Integer({ minimum: 0 }),
    lastReviewId: nullableId,
    epoch: Type.Integer({ minimum: 0 }),
    inFlightReviewId: nullableId,
    settledReviewId: nullableId,
    lastTurnId: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    lastItemId: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    delegateFailures: Type.Integer({ minimum: 0 }),
    curatorLastRunAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const INITIAL_LEARNING_STATE: LearningState = {
  userTurnsSinceReview: 0,
  toolIterationsSinceSkillWrite: 0,
  lastReviewId: null,
  epoch: 0,
  inFlightReviewId: null,
  settledReviewId: null,
  lastTurnId: null,
  lastItemId: null,
  delegateFailures: 0,
  curatorLastRunAt: null,
};

export const learningStateDecl: StateDecl<LearningState> = {
  schema: Type.Unsafe<LearningState>(shape satisfies SchemaProof<LearningState, typeof shape>),
  initial: INITIAL_LEARNING_STATE,
  version: 1,
};
