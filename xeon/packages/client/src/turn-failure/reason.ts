import { parseJson } from "@fresnel/contracts";

// 실패 문장에서 서버가 준 사유 문장을 꺼내고 시크릿 모양의 글을 가린다. 화면(desktop)과 CLI가 같이 쓴다. 순수 함수다.
// 원문 JSON은 키나 요청 번호가 섞여 있을 수 있으므로 화면에는 사유 문장만 보인다(사유가 없으면 원문 한 줄을 가린 채 보인다).

/** 가린 자리의 글 */
const MASK = "••••";

// 시크릿 모양: 제공자 키 접두(sk-, key-)가 붙은 긴 글과, 글자와 숫자가 섞인 긴 토큰(API 키 모양)
const KEY_SHAPED: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\bkey-[A-Za-z0-9_-]{6,}/gi,
  /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}/g,
];

/** 시크릿 모양의 글을 `••••`로 가린다 */
function maskKeyLike(text: string): string {
  return KEY_SHAPED.reduce((masked, pattern) => masked.replaceAll(pattern, MASK), text);
}

/** `error.message` 모양의 본문에서 문장을 꺼낸다. 모양이 아니면 null이다 */
function messageOfBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const inner = body.error;
  if (typeof inner !== "object" || inner === null || !("message" in inner)) return null;
  return typeof inner.message === "string" ? inner.message : null;
}

/** 오류 문장 안의 JSON 본문(첫 `{`부터 마지막 `}`까지)에서 `error.message`를 꺼낸다. 없으면 null이다 */
function serverMessageOf(error: string): string | null {
  const start = error.indexOf("{");
  const end = error.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  const parsed = parseJson(error.slice(start, end + 1));
  return parsed.ok ? messageOfBody(parsed.value) : null;
}

/**
 * 화면과 CLI가 보일 사유 문장. 서버 본문의 `error.message`가 있으면 그것을, 없으면 오류 문장 그대로를 준다.
 * 어느 쪽이든 시크릿 모양의 글은 `••••`로 가린다. 같은 문장에는 항상 같은 답을 준다.
 */
export function failureReasonOf(error: string): string {
  return maskKeyLike(serverMessageOf(error) ?? error);
}
