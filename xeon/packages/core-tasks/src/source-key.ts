import { assertNever } from "@xeon/contracts";
import { COMMIT_KEY_PATTERN } from "@xeon/contracts/records";
import type { InputSource } from "@xeon/contracts/services";

/** F.extensions.spec §2, PostOptions.requestId: 1~64자 */
const REQUEST_ID_MAX_LENGTH = 64;

const COMMIT_KEY_REGEX = new RegExp(COMMIT_KEY_PATTERN);

/**
 * 출처 키(L1.tasks.spec §3.6, §4.7). 서로 다른 출처가 같은 문자열의 requestId를 써도 충돌하지 않게 한다.
 * scope id의 하위 구분자 `/`는 `:`로 바꾼다(review.decisions-2 U-13)
 */
export function sourceKeyOf(source: InputSource): string {
  switch (source.type) {
    case "user":
      return "user";
    case "extension":
      return source.scopeId.replaceAll("/", ":");
    case "delegation":
      return "deleg";
    case "schedule":
      return "timer";
    default:
      return assertNever(source, "sourceKeyOf");
  }
}

function isValidRequestId(requestId: string): boolean {
  return requestId.length >= 1 && requestId.length <= REQUEST_ID_MAX_LENGTH;
}

/**
 * 입력 큐 커밋 키 `in:<sourceKey>:<requestId>`(eng.transactions.design §4.8).
 * 요청 id나 출처 키가 COMMIT_KEY_PATTERN 밖이면 null
 */
export function inputCommitKey(sourceKey: string, requestId: string): string | null {
  if (!isValidRequestId(requestId)) return null;
  const key = `in:${sourceKey}:${requestId}`;
  return COMMIT_KEY_REGEX.test(key) ? key : null;
}
