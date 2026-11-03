import { createHash, randomUUID } from "node:crypto";

/** 인자 묶음의 해시(승인 body의 `argsHash`). 같은 인자는 같은 값이다 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 승인 요청의 멱등 키로 쓰는 새 값. 호출마다 새로 만들어 이전 승인이 다음 호출에 재사용되지 않게 한다 */
export function freshRequestKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
