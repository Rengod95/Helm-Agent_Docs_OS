import { createHash } from "node:crypto";

/** 바이트의 sha256 hex(소문자 64자). 원본 blob 해시와 쓸 내용 해시가 이 값이다 */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 문자열(UTF-8로 본다)의 sha256 hex. 커밋 키 부분을 만들 때 쓴다 */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
