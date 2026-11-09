// 글 규칙. 데스크톱 셸(`src/main/*.ts`)이 쓰는 글자 규칙을 브라우저에서 같게 건다.
const CONTROL = /\p{Cc}/u;
const LINE_BREAKS: ReadonlySet<string> = new Set(["\n", "\r", "\t"]);

/** 열 수 있는 주소의 길이 상한(바이트). 데스크톱 `MAX_HREF_BYTES`와 같다 */
const HREF_MAX_BYTES = 2048;
/** 알림 대화 id의 글자 상한 */
const THREAD_ID_MAX_CHARS = 128;
/** 저장 이름의 글자 상한 */
const FILE_NAME_MAX_CHARS = 200;
const FALLBACK_FILE_NAME = "export.txt";

/** 줄바꿈과 탭은 빈칸으로, 나머지 제어 문자는 뺀다. 코드 포인트 `max`개까지 남기고 앞뒤 공백을 뗀다 */
export function cleanText(text: string, max: number): string {
  return Array.from(text)
    .map((ch) => (LINE_BREAKS.has(ch) ? " " : ch))
    .filter((ch) => !CONTROL.test(ch))
    .slice(0, max)
    .join("")
    .trim();
}

function restAfterScheme(href: string): string | null {
  if (href.startsWith("https://")) return href.slice("https://".length);
  if (href.startsWith("http://")) return href.slice("http://".length);
  return null;
}

/**
 * 열어도 되는 주소인가. `http://` 또는 `https://`로 시작하고, 호스트가 있으며, 계정 정보(`@`)와 공백과 제어 문자가 없어야 한다.
 * `mailto`는 데스크톱 `open-external.ts`가 허용하지 않으므로 여기서도 거절한다.
 */
export function isAllowedHref(href: string): boolean {
  if (href === "" || new TextEncoder().encode(href).byteLength > HREF_MAX_BYTES) return false;
  if (/[\p{Cc}\p{White_Space}]/u.test(href)) return false;
  const rest = restAfterScheme(href);
  if (rest === null) return false;
  const [authority = ""] = rest.split(/[/?#]/u);
  return authority !== "" && !authority.includes("@");
}

/** 대화 id를 기록해도 되는 형식인가. 비어 있지 않고, 상한 이하이며, 제어 문자가 없어야 한다 */
export function validThreadId(id: string): boolean {
  return id !== "" && Array.from(id).length <= THREAD_ID_MAX_CHARS && !CONTROL.test(id);
}

/** 제안 이름을 파일 이름 하나로 줄인다. 경로 구분자 앞부분은 버리고, 제어 문자를 뺀 뒤 상한으로 자른다. 남는 것이 없으면 `export.txt` */
export function bareFileName(suggested: string): string {
  const last = suggested.split(/[\\/]/u).at(-1) ?? "";
  const kept = Array.from(last)
    .filter((ch) => !CONTROL.test(ch))
    .slice(0, FILE_NAME_MAX_CHARS)
    .join("");
  const name = kept.trim();
  return name === "" || name === "." || name === ".." ? FALLBACK_FILE_NAME : name;
}

/** 파일 이름의 확장자로 내용 종류를 고른다. 내보내기는 Markdown과 JSON이고 나머지는 평문이다 */
export function mimeOf(name: string): string {
  if (name.endsWith(".json")) return "application/json;charset=utf-8";
  if (name.endsWith(".md")) return "text/markdown;charset=utf-8";
  return "text/plain;charset=utf-8";
}

/** 바이트를 표준 base64 글로. 큰 배열이 인자 목록을 넘지 않게 나눠 넣는다 */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
