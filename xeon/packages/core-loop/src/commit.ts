import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type {
  CommitRequest,
  CommitResult,
  SessionService,
  StoreError,
} from "@xeon/contracts/records";

type Committed = Extract<CommitResult, { readonly status: "committed" }>;

export type CommitFailure =
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "rejected"; readonly code: string; readonly detail: string | null }
  | { readonly kind: "key_reused"; readonly requestId: string };

export type CommitOutcome = Result<Committed, CommitFailure>;

/** 같은 요청으로 시도하는 횟수(TX-05). 첫 시도를 포함하고 `busy`만 다시 시도한다 */
const COMMIT_ATTEMPTS: number = 3;

/**
 * 커밋 한 번. `busy`는 같은 요청 객체(같은 커밋 키)로 다시 시도한다(TX-05, L1.loop.spec §5 "T4 커밋 busy").
 * `rejected`는 저장되는 결과라 다시 시도해도 같으므로 바로 돌려준다. 호출자가 사유 코드로 분기한다.
 */
export function commitWithRetry(
  session: Pick<SessionService, "commit">,
  request: CommitRequest,
  attempts: number = COMMIT_ATTEMPTS,
): CommitOutcome {
  let last: CommitFailure = { kind: "store", error: { kind: "busy" } };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = session.commit(request);
    if (!result.ok) {
      last = { kind: "store", error: result.error };
      if (result.error.kind === "busy") continue;
      return err(last);
    }
    const value = result.value;
    switch (value.status) {
      case "committed":
        return ok(value);
      case "rejected":
        return err({ kind: "rejected", code: value.code, detail: value.detail });
      case "key_reused":
        return err({ kind: "key_reused", requestId: value.requestId });
      default:
        return assertNever(value, "CommitResult");
    }
  }
  return err(last);
}

/** 실패를 한 줄 문자열로 줄인다. 로그와 RunFailure 설명에 쓴다 */
export function describeCommitFailure(failure: CommitFailure): string {
  switch (failure.kind) {
    case "store":
      return `store:${failure.error.kind}`;
    case "rejected":
      return `rejected:${failure.code}`;
    case "key_reused":
      return `key_reused:${failure.requestId}`;
    default:
      return assertNever(failure, "CommitFailure");
  }
}
