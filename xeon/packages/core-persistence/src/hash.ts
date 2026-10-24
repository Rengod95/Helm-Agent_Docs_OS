import { createHash } from "node:crypto";

/** 문자열의 SHA-256 소문자 hex(64자). 커밋 지문(eng.transactions.design §4.7)에 쓴다 */
export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}
