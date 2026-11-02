import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/schema-proof.ts";
import type { ItemId, ThreadId, TurnId } from "../conversation/index.ts";
import {
  QuestionApprovalDetailSchema,
  type ApprovalResolvedPayload,
  type QuestionAnswerJson,
  type QuestionApprovalDetail,
} from "../records/index.ts";
import type { PostItem } from "./post.ts";
import type { DriveLockId, RegistrationId } from "./registration-id.ts";

export interface DriveLimits {
  readonly maxTurns?: number;
  readonly maxSpawns?: number;
  readonly maxTokens?: number;
}

export interface DriveOptions {
  /** 그룹이 요청하는 상한. 없는 필드는 X 기본값 `x.primitives.driveDefaultLimits`를 쓰고, 천장 `x.primitives.driveLimits`보다 클 수 없다 */
  readonly limits?: DriveLimits;
}

/** 남은 예산. null은 상한 없음 */
export interface DriveLockBudget {
  readonly turns: number | null;
  readonly spawns: number | null;
  readonly tokens: number | null;
}

/** drive 함수의 `loop.turn()` 입력. wire의 TurnStartInput과 모양이 달라 이름을 나눈다 */
export interface TurnInput {
  readonly input: PostItem;
  /**
   * 생략하면 X가 `${leaseId}:${순번}`으로 결정적으로 만든다. 같은 순서의 재호출은 커밋된 결과를 돌려받는다.
   * 명시하면 같은 커밋 상태와 페이로드에서 같은 값이 나와야 한다(ADR-0015 §3.4 1)
   */
  readonly requestId?: string;
}

export interface TurnOutcome {
  readonly turnId: TurnId;
  readonly status: "completed" | "aborted" | "error";
  /** 마지막 어시스턴트 아이템 */
  readonly finalItemId?: ItemId;
}

export interface SpawnSpec {
  /** 서브에이전트 정의 이름(L1.agents.spec) */
  readonly agent: string;
  readonly task: string;
  readonly requestId?: string;
  readonly background?: boolean;
}

export interface SpawnOutcome {
  readonly childThreadId: ThreadId;
  readonly status: "completed" | "aborted" | "error";
  readonly answer?: string;
}

/** `loop.ask`가 사용자에게 보이는 질문 카드. ADR-0018 question kind의 본문과 같다(질문 1~4개) */
export type AskCard = QuestionApprovalDetail;

export interface AskRequest {
  /**
   * 필수, 1~64자. 같은 대화에서 같은 `requestId`의 재호출은 새 승인을 만들지 않고 기록된 답을 돌려준다.
   * 결정적이어야 한다(ADR-0015 §3.4). Registration id로 시작하는 이름을 권한다
   */
  readonly requestId: string;
  readonly card: AskCard;
  /** 승인 카드 제목 1~120자. 생략하면 플러그인 그룹 표시 이름 */
  readonly title?: string;
}

/** 승인 응답의 결과. 질문에 답했거나(`answered`), 거부·취소·만료·비대화형 처리로 끝났다(`denied`) */
export type AskOutcome =
  | { readonly status: "answered"; readonly answer: QuestionAnswerJson }
  | {
      readonly status: "denied";
      readonly resolvedBy: ApprovalResolvedPayload["resolvedBy"];
      readonly feedback?: string;
    };

const AskRequestShape = Type.Object(
  {
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    card: QuestionApprovalDetailSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);
export const AskRequestSchema: TUnsafe<AskRequest> = Type.Unsafe<AskRequest>(
  AskRequestShape satisfies SchemaProof<AskRequest, typeof AskRequestShape>,
);

/**
 * drive 함수가 루프에 효과를 내는 통로. 루프에 대한 효과는 `turn`과 `spawn`뿐이다(post와 scope commit 제외).
 * drive 함수가 낼 수 있는 효과의 전체 목록(위임, 기능 호출 포함)은 `REPLAY_EFFECT_TABLE`(ADR-0015 §3.2)이다
 */
export interface LoopHandle {
  turn(input: TurnInput): Promise<TurnOutcome>;
  spawn(spec: SpawnSpec): Promise<SpawnOutcome>;
  /**
   * 사람 확인 원시(X-17, ADR-0018). 첫 호출은 question kind 승인(`origin.caller`는 `ext:<그룹>`, 화면은 `grp:<그룹>`으로 보임)을 만들고
   * drive lock을 사유 `waiting`으로 반납한다. 반납과 함께 `signal`이 켜지고 이 약속은 이행되지 않는다. `approval.resolved`가 오면 X가 그 Registration을
   * 다시 후보로 올리고, drive lock을 다시 받으면 drive 함수가 마지막 커밋 상태로 다시 호출된다. 같은 `requestId`로 `ask`를 다시 부르면
   * 기록된 결과를 바로 돌려준다. 기다리는 동안 turn·spawn 예산은 쓰지 않는다
   */
  ask(request: AskRequest): Promise<AskOutcome>;
  readonly budget: DriveLockBudget;
  /** 임대가 회수되면 중단 신호가 켜진다 */
  readonly signal: AbortSignal;
}

/** 경계마다 마지막 커밋 상태로 다시 호출된다(F.extensions.spec §4.6) */
export type DriveFn<S> = (loop: LoopHandle, state: Readonly<S>) => Promise<void>;

export interface DriveLock {
  readonly leaseId: DriveLockId;
  readonly scopeId: RegistrationId;
  readonly limits: DriveLimits;
  readonly status: "active" | "releasing" | "released";
}
