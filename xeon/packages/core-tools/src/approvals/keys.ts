import { commitKeyPart } from "@xeon/contracts/records";
import { sha256HexSync } from "../util.ts";

// 승인 요청이 쓰는 키 함수 모음(review.open-issues N-07). 밖에서 온 id(toolCallId, L2 requestId)가 키 알파벳 밖의 문자나
// 한도 밖의 길이를 가질 수 있어, 모든 승인 키는 이 파일의 함수를 거친다. 변환은 `commitKeyPart`(eng.transactions.design §4.7, U-13) 하나를
// 바탕으로 하고, 한도(요청 키 48자, 커밋 키 64자)가 계약마다 달라 함수는 용도별로 나눈다:
//
// | 함수 | 값 | 한도 | 쓰는 곳 |
// |---|---|---|---|
// | requestKeyFor | `ApprovalRequestInput.requestKey` | 1~48자 | 파이프라인의 도구 승인, L2 어댑터의 requestId |
// | requestCommitKey | `approval.requested` 커밋 키 | 1~64자 | ApprovalService.open |
// | resolveCommitKey | `approval.resolved` 커밋 키 | approvalId(EventId)에서 결정 | ApprovalService.commitResolution |
//
// 서비스 호출 멱등 키(`entries.ts` requestIdFor, `CallOptions.requestId` 1~64자)는 커밋 키에 들어가지 않는 다른 계약이라 이 파일에 두지 않는다.

/** `ApprovalRequestInput.requestKey`의 길이 상한 */
const REQUEST_KEY_MAX = 48;
const COMMIT_KEY_MAX = 64;
/** requestKeyFor가 길이나 문자 때문에 해시로 바꾼 키. 커밋 키 부분으로 다시 바꾸지 않는다 */
const HASHED_REQUEST_KEY = /^h_[0-9a-f]{40}$/;

/** 요청 키로 쓸 수 있는 값인가(1~48자). 호출자가 직접 넘기는 키를 검사한다 */
export function isRequestKey(value: string): boolean {
  return value.length >= 1 && value.length <= REQUEST_KEY_MAX;
}

/**
 * 승인 요청의 멱등 키(1~48자). 도구 승인은 toolCallId에서, L2 어댑터는 자기 requestId에서 만든다. 둘 다 밖의 값이라
 * 커밋 키 알파벳 밖의 문자를 가질 수 있다. 그래서 커밋 키 부분 변환(`commitKeyPart`)을 거치고, 48자를 넘으면 원문의 해시로 줄인다(결정적).
 * 같은 원문은 항상 같은 키이고 다른 원문이 같은 키가 되지 않는다(해시 40자)
 */
export function requestKeyFor(raw: string): string {
  const part = commitKeyPart(raw, sha256HexSync);
  if (part.length <= REQUEST_KEY_MAX) return part;
  return `h_${sha256HexSync(raw).slice(0, 40)}`;
}

/**
 * approval.requested의 커밋 키. requestKey는 호출자가 넘기는 밖의 값이라 커밋 키 부분 변환(`commitKeyPart`)을 거쳐 넣는다
 * (`requestKeyFor`가 이미 해시로 줄인 키는 그대로). 전체가 64자를 넘으면 해시로 바꾼다
 */
export function requestCommitKey(surfaceThreadId: string, requestKey: string): string {
  const part = HASHED_REQUEST_KEY.test(requestKey)
    ? requestKey
    : commitKeyPart(requestKey, sha256HexSync);
  const plain = `approval:${surfaceThreadId}:${part}:request`;
  if (plain.length <= COMMIT_KEY_MAX) return plain;
  const hash = sha256HexSync(`${surfaceThreadId}:${part}`);
  return `approval:${hash.slice(0, 32)}:request`;
}

export function resolveCommitKey(approvalId: string): string {
  return `approval:${approvalId}:resolve`;
}
