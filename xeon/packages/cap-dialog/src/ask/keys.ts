import { L2_APPROVAL_REQUEST_ID_MAX } from "@xeon/contracts/services";

// FNV-1a 32비트. 키를 줄일 때 쓰는 해시라 암호 강도는 필요 없다. 같은 입력이 같은 키가 되면 된다.
function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * 호출 `requestId`(1~64자)를 승인 요청 키(1~48자)로 바꾼다. 48자 이하면 그대로 쓰고, 넘으면 앞 24자와 해시 23자로 줄인다.
 * 단순히 자르면 앞이 같은 서로 다른 호출이 같은 키가 되어 다른 질문이 기존 요청을 돌려받기 때문이다.
 */
export function approvalKeyOf(requestId: string): string {
  if (requestId.length <= L2_APPROVAL_REQUEST_ID_MAX) return requestId;
  const digest =
    hex8(fnv1a(requestId, 0x811c9dc5)) +
    hex8(fnv1a(requestId, 0x01000193)) +
    hex8(fnv1a(requestId, 0xdeadbeef));
  return `${requestId.slice(0, 24)}~${digest.slice(0, L2_APPROVAL_REQUEST_ID_MAX - 25)}`;
}
