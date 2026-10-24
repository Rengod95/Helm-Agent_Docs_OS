import type { Result } from "@xeon/contracts";
import type {
  CommitRequest,
  CommitResult,
  EventFeed,
  ProjectionQuery,
  StoreError,
  ThreadLifecycle,
} from "@xeon/contracts/records";

/**
 * core-tasks가 xeon.session(SessionService)에서 쓰는 부분. 실제 SessionService가 그대로 맞는다.
 * 쓰기는 commit 한 경로뿐이다(TX-07). 읽기는 투영 질의와 이벤트 피드의 동기 읽기다
 */
export interface TasksSession {
  commit(request: CommitRequest): Result<CommitResult, StoreError>;
  readonly query: Pick<ProjectionQuery, "queuedInputs">;
  readonly feed: Pick<EventFeed, "headSeq" | "read" | "onCommit">;
  readonly threads: Pick<ThreadLifecycle, "list">;
}

/** busy 재시도 횟수(첫 시도 포함) */
const COMMIT_ATTEMPTS = 3;

/** 같은 CommitRequest로 다시 보낸다(TX-05). 새 키로 재시도하지 않는다 */
export function commitWithRetry(
  session: Pick<TasksSession, "commit">,
  request: CommitRequest,
): Result<CommitResult, StoreError> {
  let result = session.commit(request);
  for (let attempt = 1; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    if (result.ok || result.error.kind !== "busy") break;
    result = session.commit(request);
  }
  return result;
}

/** 로그 필드에 넣을 오류 설명. 값이 Error가 아니면 고정 문구 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "non-error value thrown";
}
