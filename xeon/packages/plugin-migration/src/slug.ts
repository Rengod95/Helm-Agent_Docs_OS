// 이름과 글자 수 도우미. 플러그인 이름(확장 이름 규칙), 서브에이전트 이름, 파일 이름, 글자 수 상한을 한 곳에서 다룬다.
// 모두 순수 함수다. 글자 수는 코드 포인트 단위로 센다(한글과 ASCII가 한 글자씩이다).
import { EXTENSION_NAME_PATTERN } from "@fresnel/contracts/extensions";
import { AGENT_NAME_PATTERN } from "@fresnel/contracts/services";

const EXTENSION_NAME = new RegExp(EXTENSION_NAME_PATTERN);
const AGENT_NAME = new RegExp(AGENT_NAME_PATTERN);

const EXTENSION_NAME_MAX = 32;
const AGENT_NAME_MAX = 48;

export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function headCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * 글자 수 상한을 넘으면 문장 끝(`.`, `。`, 줄바꿈)에서 자른다. 상한 안에 경계가 없으면 상한 글자에서 자른다.
 * 경계 문자 `.`는 남기고 줄바꿈은 버린다. 조용히 자르지 않도록 호출자가 보고 줄에 적는다.
 */
export function truncateAtSentence(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max);
  for (let end = head.length; end > 0; end -= 1) {
    const last = head[end - 1];
    if (last === "\n") {
      const cut = head
        .slice(0, end - 1)
        .join("")
        .trimEnd();
      if (cut !== "") return cut;
    }
    if (last === "." || last === "。") {
      return head.slice(0, end).join("").trimEnd();
    }
  }
  return head.join("");
}

/** 소문자 영숫자와 하이픈으로 바꾸고, 앞의 영문자가 아닌 글자와 끝의 하이픈을 떼고, 상한에서 자른다 */
function slugCore(text: string, max: number): string {
  const lowered = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return lowered
    .replace(/^[^a-z]+/, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** 플러그인 이름(확장 이름 규칙, 2~32자)으로 바꾼다. 못 맞추면 undefined */
export function extensionNameFrom(text: string): string | undefined {
  const slug = slugCore(text, EXTENSION_NAME_MAX);
  return EXTENSION_NAME.test(slug) ? slug : undefined;
}

/** 서브에이전트 이름(AGENT_NAME_PATTERN, 2~48자)으로 바꾼다. 못 맞추면 undefined */
export function agentNameFrom(text: string): string | undefined {
  const slug = slugCore(text, AGENT_NAME_MAX);
  return AGENT_NAME.test(slug) ? slug : undefined;
}

/** 이름이 겹칠 때 붙이는 접미사(`-2`, `-3`). 32자 안에서 자른다 */
export function suffixedName(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${base.slice(0, EXTENSION_NAME_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/** 파일 이름 한 조각. 글자, 숫자, `.`, `_`, `-`만 남기고 나머지는 `-`로 바꾼다. 앞의 `.`은 뗀다 */
export function fileStem(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+$/, "");
  return cleaned === "" ? "item" : cleaned;
}

/** 경로 한 조각으로 안전한가(빈 조각, `.`, `..`, 구분자가 없다) */
export function isSafeSegment(segment: string): boolean {
  return (
    segment !== "" &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\")
  );
}

/** 상대 경로가 폴더 밖으로 나가지 않고 `/`로만 나뉘는가 */
export function isSafeRelativePath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    path.split("/").every((segment) => isSafeSegment(segment))
  );
}
