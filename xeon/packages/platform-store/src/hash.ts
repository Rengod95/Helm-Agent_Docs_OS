import { createHash } from "node:crypto";

/** 문자열 또는 바이트의 SHA-256 소문자 hex(64자). 체크섬, 블롭 주소, 잠금 키 이름에 쓴다 */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
