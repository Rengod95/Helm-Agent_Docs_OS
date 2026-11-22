import { createHash } from "node:crypto";

/** 소문자 16진 SHA-256. 후보 본문 해시와 결정적 id 재료에 쓴다 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
