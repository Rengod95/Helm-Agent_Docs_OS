import { assertNever } from "@xeon/contracts";
import type {
  CommitRequest,
  CommitResult,
  SessionService,
  StoreError,
} from "@xeon/contracts/records";

// 세션 커밋 경로(eng.transactions.design TX-07). 커밋은 동기이고 트랜잭션 안에서 await하지 않는다(TX-01).

export type CommitFailure =
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "rejected"; readonly code: string; readonly detail: string | null }
  | { readonly kind: "key_reused"; readonly requestId: string };

type CommittedResult = Extract<CommitResult, { readonly status: "committed" }>;

export type CommitOutcome =
  | { readonly ok: true; readonly result: CommittedResult }
  | { readonly ok: false; readonly failure: CommitFailure };

/** busy는 같은 요청(같은 키)으로 다시 낸다(TX-05). 그 밖의 실패는 값으로 돌려준다 */
const MAX_BUSY_ATTEMPTS = 3;

export function commitWithRetry(
  session: Pick<SessionService, "commit">,
  request: CommitRequest,
): CommitOutcome {
  let last: CommitOutcome | undefined;
  for (let attempt = 1; attempt <= MAX_BUSY_ATTEMPTS; attempt += 1) {
    const stored = session.commit(request);
    if (!stored.ok) {
      last = { ok: false, failure: { kind: "store", error: stored.error } };
      if (stored.error.kind === "busy") continue;
      return last;
    }
    const result = stored.value;
    switch (result.status) {
      case "committed":
        return { ok: true, result };
      case "rejected":
        return {
          ok: false,
          failure: { kind: "rejected", code: result.code, detail: result.detail },
        };
      case "key_reused":
        return { ok: false, failure: { kind: "key_reused", requestId: result.requestId } };
      default:
        return assertNever(result, "commitWithRetry");
    }
  }
  return last ?? { ok: false, failure: { kind: "store", error: { kind: "busy" } } };
}

export function describeFailure(failure: CommitFailure): string {
  switch (failure.kind) {
    case "store":
      return `store error: ${failure.error.kind}`;
    case "rejected":
      return `commit rejected: ${failure.code}`;
    case "key_reused":
      return `commit key reused: ${failure.requestId}`;
    default:
      return assertNever(failure, "describeFailure");
  }
}
