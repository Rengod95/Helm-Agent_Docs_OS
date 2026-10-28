import type { ItemId, ThreadId, TurnId } from "../conversation/index.ts";
import type { PostItem } from "./post.ts";
import type { LeaseId, ScopeId } from "./scope-id.ts";

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
export interface LeaseBudget {
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

/**
 * drive 함수가 루프에 효과를 내는 통로. 루프에 대한 효과는 `turn`과 `spawn`뿐이다(post와 scope commit 제외).
 * drive 함수가 낼 수 있는 효과의 전체 목록(위임, 능력 호출 포함)은 `REPLAY_EFFECT_TABLE`(ADR-0015 §3.2)이다
 */
export interface LoopHandle {
  turn(input: TurnInput): Promise<TurnOutcome>;
  spawn(spec: SpawnSpec): Promise<SpawnOutcome>;
  readonly budget: LeaseBudget;
  /** 임대가 회수되면 중단 신호가 켜진다 */
  readonly signal: AbortSignal;
}

/** 경계마다 마지막 커밋 상태로 다시 호출된다(F.extensions.spec §4.6) */
export type DriveFn<S> = (loop: LoopHandle, state: Readonly<S>) => Promise<void>;

export interface DriveLease {
  readonly leaseId: LeaseId;
  readonly scopeId: ScopeId;
  readonly limits: DriveLimits;
  readonly status: "active" | "releasing" | "released";
}
