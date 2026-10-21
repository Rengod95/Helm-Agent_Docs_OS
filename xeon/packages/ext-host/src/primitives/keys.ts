import { createHash } from "node:crypto";

/** 커밋 키에 그대로 넣을 수 있는 문자들(COMMIT_KEY_PATTERN의 부분집합) */
const KEY_SAFE = /^[A-Za-z0-9_.:-]{1,120}$/;

/** SHA-256 앞 12자. scope id 해시와 키 줄임에 쓴다(X.primitives.spec §4.6.1) */
export function hash12(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** 커밋 키 부품으로 쓸 문자열. 허용 문자가 아니거나 길면 해시로 바꾼다 */
export function keyPart(text: string): string {
  return KEY_SAFE.test(text) ? text : `h${hash12(text)}`;
}
