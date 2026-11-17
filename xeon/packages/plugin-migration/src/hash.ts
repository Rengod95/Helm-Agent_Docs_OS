import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 항목 식별자: (하네스, 종류, 범위, 키 경로)의 해시 앞 16자리. 내용이 바뀌어도 같다(§6.5) */
export function itemIdOf(parts: readonly string[]): string {
  return sha256Hex(parts.join("\u0000")).slice(0, 16);
}
