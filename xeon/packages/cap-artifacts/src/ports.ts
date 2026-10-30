import type { Result } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { EnqueueError, PostItem, PostWhen } from "@xeon/contracts/extensions";
import type { GuardExecutionOutcome, LoopError } from "@xeon/contracts/services";

// L2.artifacts.spec §3.8. 리뷰가 쓰는 하위 서비스의 좁은 모양. 플러그인이 실제 포트와 능력에서 만들고, 시험은 직접 넘긴다.

/** 파일 되돌림 실패의 이유. `code`는 workspace.files 오류 코드나 이 패키지의 사유 코드다 */
interface ReplaceFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * 작업 공간 파일에서 한 구간을 바꾼다(`workspace.files.edit`, spec §4.2.5 후보 A). 경로 해석, 보호 경로, 동시 변경 감지는 workspace가 한다.
 * `oldText`가 파일에 정확히 한 곳에만 있어야 한다.
 */
export interface ReviewFilesPort {
  replace(input: {
    readonly threadId: ThreadId;
    readonly path: string;
    readonly oldText: string;
    readonly newText: string;
    readonly requestId: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<void, ReplaceFailure>>;
}

/** 출력을 실행에 넘기기 전의 가드(`xeon.loop`의 `guardExecution`) */
export interface ExecutionGuardPort {
  check(input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly content: string;
    readonly requestId: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<GuardExecutionOutcome, LoopError>>;
}

/** 에이전트 입력 큐(`xeon.tasks`). 조립 루트가 이 확장의 scopeId를 묶어 넘긴다 */
export interface ReviewQueuePort {
  enqueue(input: {
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly when: PostWhen;
    readonly item: PostItem;
  }): Promise<Result<{ readonly duplicate: boolean }, EnqueueError>>;
}
