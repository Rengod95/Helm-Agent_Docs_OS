import { createHash } from "node:crypto";

/** 커밋 키 부분과 승인 요청 키를 만드는 동기 해시(F commitKeyPart·requestKeyFor의 sha256Hex 인자) */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
