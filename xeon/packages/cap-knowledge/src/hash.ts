import { createHash } from "node:crypto";
import { attempt } from "@xeon/contracts";

/** 소문자 hex sha256. 문자열은 UTF-8로 본다 */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** UTF-8로 읽는다. 올바른 UTF-8이 아니면 undefined (바이너리 판정에 쓴다) */
export function utf8DecodeStrict(bytes: Uint8Array): string | undefined {
  const decoded = attempt(() => decoder.decode(bytes));
  return decoded.ok ? decoded.value : undefined;
}

/** UTF-8 바이트 순 비교. 경로 정렬과 트리 해시가 쓴다 */
export function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
