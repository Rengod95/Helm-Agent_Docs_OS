import { createHash } from "node:crypto";
import { attempt } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";

/** JSON으로 직렬화되는 값인가. undefined, 함수, NaN·Infinity는 아니다 */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.every((item) => isJsonValue(item, depth + 1));
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((member: unknown) => isJsonValue(member, depth + 1));
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && typeof value === "object" && value !== null && !Array.isArray(value);
}

const textEncoder = new TextEncoder();

export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(text);
}

/** 소문자 hex SHA-256. Web Crypto를 쓴다 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", utf8Bytes(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 소문자 hex SHA-256, 동기. 커밋 키 부분(commitKeyPart)처럼 동기 해시가 필요한 곳에 쓴다 */
export function sha256HexSync(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/** `*`(임의 문자열)와 `?`(한 글자)만 쓰는 glob을 전체 일치 정규식으로 바꾼다 */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (const char of glob) {
    if (char === "*") source += "[\\s\\S]*";
    else if (char === "?") source += "[\\s\\S]";
    else source += char.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function globMatches(glob: string, text: string): boolean {
  return globToRegExp(glob).test(text);
}

/** 정규식 원문을 컴파일한다. 문법 오류면 undefined */
export function tryRegExp(pattern: string): RegExp | undefined {
  const compiled = attempt(() => new RegExp(pattern));
  return compiled.ok ? compiled.value : undefined;
}

/** 순서대로 하나씩 실행한다. 앞 항목이 끝나야 다음 항목을 시작한다 */
export function eachInOrder<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => fn(item)),
    Promise.resolve(),
  );
}

/** unknown으로 잡은 값에서 사람이 읽을 메시지를 꺼낸다 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

/** 신호가 여럿이면 하나로 합친다. undefined는 건너뛴다 */
export function mergeSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  return AbortSignal.any(present);
}
