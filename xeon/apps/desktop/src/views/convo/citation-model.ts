import type { ItemRecord } from "@fresnel/contracts/conversation";
import type { ItemShape } from "../../state/engine/index.ts";
import { WEB_TOOLS, webSourcesOf, type WebSource } from "../tool-extras-model.ts";

// 답 본문의 출처 표식(dzG 시안 §7, DP-149). 화면 없이 시험하는 순수 함수들이다.
// 웹 도구 결과는 `[sN] 제목 (날짜) 주소` 줄로 출처를 주고, 출처 id는 대화 전체에서 같은 주소에 같은 번호다(cap-web source-ids).
// 모델은 답에 `[s2]`, `[s1][s2]`, `(출처: [s2] 제목 – https://… / [s1] https://…)`처럼 쓴다. 보이는 글만 번호 칩 링크
// `[2](#cite-s2)`로 바꾸고, 표식 옆 출처 제목·주소만 든 괄호는 칩만 남긴다. 모델 문맥(기록 글)은 바꾸지 않는다.
// 코드 블록과 인라인 코드 안, 이 대화에 없는 출처 표식은 그대로 둔다.

/** 본문 칩 링크의 주소 머리. `#cite-s2`처럼 출처 id가 뒤에 붙는다 */
const CITE_HREF = "#cite-";

/** `s12` → 12. 출처 id가 아니면 null */
export function citationNumberOf(id: string): number | null {
  const found = /^s(\d+)$/.exec(id);
  return found === null ? null : Number(found[1]);
}

/** 칩 링크 주소에서 출처 id를 읽는다. 칩 링크가 아니면 null */
export function citationIdOfHref(href: string | undefined): string | null {
  if (href === undefined || !href.startsWith(CITE_HREF)) return null;
  const id = href.slice(CITE_HREF.length);
  return citationNumberOf(id) === null ? null : id;
}

/** 열린 대화의 웹 도구 호출 id(기록 순서) */
export function webCallIdsOf(shapes: readonly ItemShape[]): readonly string[] {
  return shapes.flatMap((shape) =>
    shape.kind === "assistant"
      ? shape.blocks.flatMap((block) =>
          block.kind === "call" && WEB_TOOLS.includes(block.name) ? [block.callId] : [],
        )
      : [],
  );
}

/** 도구 결과 item의 글. 결과가 아니거나 아직 없으면 빈 글 */
function resultTextOf(item: ItemRecord | undefined): string {
  if (item?.kind !== "toolResult") return "";
  return item.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

/** 웹 도구 결과들에서 출처 id → 출처. 같은 id가 다시 나오면 먼저 나온 것을 쓴다 */
export function citationSourcesOf(
  results: readonly (ItemRecord | undefined)[],
): ReadonlyMap<string, WebSource> {
  const out = new Map<string, WebSource>();
  for (const result of results) {
    for (const source of webSourcesOf(resultTextOf(result))) {
      if (!out.has(source.id)) out.set(source.id, source);
    }
  }
  return out;
}

/** 출처 칩 목록 앞 번호. 출처 id가 sN이면 N, 아니면 같은 주소를 가진 대화 출처의 N, 없으면 null */
export function sourceNumberOf(
  source: WebSource,
  known: ReadonlyMap<string, WebSource>,
): number | null {
  const own = citationNumberOf(source.id);
  if (own !== null) return own;
  for (const candidate of known.values()) {
    if (candidate.url === source.url) return citationNumberOf(candidate.id);
  }
  return null;
}

// 백틱은 \x60으로 쓴다(check-ts-rules가 정규식 안의 백틱을 템플릿 시작으로 읽는다)
const FENCE = /^ {0,3}(\x60{3,}|~{3,})/;
const CODE_SPAN = /(\x60+)[\s\S]*?[^\x60]\1(?!\x60)|(\x60+)\2(?!\x60)/g;
const MARKER = /\\?\[(s\d+)\](?!\()/g;
const MARKER_RUN = /\[(s\d+)\]/g;
/** 한 겹 안쪽 괄호까지 받는다(주소 안의 괄호) */
const PAREN = /\(((?:[^()\n]|\([^()\n]*\))*)\)/g;
const URL_IN = /https?:\/\/[^\s<>()[\]]+(?:\([^\s()]*\)[^\s<>()[\]]*)*/;
const URL_AFTER_MARKER = /^[ \t]*(?:[-–—:·][ \t]*)?<?https?:\/\/[^\s<>()[\]]+>?/;
/** 괄호 안 표식 앞에 올 수 있는 짧은 이름표("출처:", "Sources:") */
const LABEL = /^[^\s:：[\]]{1,12}[ \t]*[:：]$/u;
/** 출처 사이 구분 글자 */
const SEPARATORS = /^[\s/,;·|–—-]+|[\s/,;·|–—-]+$/g;

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 표식 뒤 글이 출처 이름·주소뿐인가: 비었거나, 주소를 품었거나, 그 출처의 제목·도메인과 같다 */
function isSourceTail(tail: string, source: WebSource | undefined): boolean {
  const bare = tail.replace(SEPARATORS, "");
  if (bare === "") return true;
  if (URL_IN.test(bare)) return true;
  if (source === undefined) return false;
  const text = normalized(bare);
  return text === normalized(source.title) || text === normalized(source.domain);
}

/**
 * 괄호 안이 이 대화 출처 표식과 그 제목·주소뿐이면 그 표식 id들(나온 순서, 겹침 없음), 아니면 null.
 * 첫 표식 앞에는 비었거나 짧은 이름표만 올 수 있다
 */
function sourceOnlyIds(
  inner: string,
  known: ReadonlyMap<string, WebSource>,
): readonly string[] | null {
  const markers = [...inner.matchAll(MARKER_RUN)];
  const first = markers[0];
  if (first === undefined) return null;
  const head = inner.slice(0, first.index).trim();
  if (head !== "" && !LABEL.test(head)) return null;
  const ids: string[] = [];
  for (const [at, marker] of markers.entries()) {
    const id = marker[1] ?? "";
    if (!known.has(id)) return null;
    const end = markers[at + 1]?.index ?? inner.length;
    const tail = inner.slice(marker.index + marker[0].length, end);
    if (!isSourceTail(tail, known.get(id))) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function chipOf(id: string): string {
  return `[${String(citationNumberOf(id) ?? 0)}](${CITE_HREF}${id})`;
}

/** 코드가 아닌 글 조각 하나를 바꾼다 */
function linkPlain(text: string, known: ReadonlyMap<string, WebSource>): string {
  // 1) 출처뿐인 괄호는 칩만 남긴다
  const collapsed = text.replace(PAREN, (whole: string, inner: string) => {
    const ids = sourceOnlyIds(inner, known);
    return ids === null ? whole : ids.map(chipOf).join("");
  });
  // 2) 남은 표식을 칩으로 바꾸고, 표식 바로 뒤 맨 주소는 지운다
  let out = "";
  let from = 0;
  for (const marker of collapsed.matchAll(MARKER)) {
    const id = marker[1] ?? "";
    // 이스케이프한 표식과 이 대화에 없는 출처는 글 그대로
    if (marker[0].startsWith("\\") || !known.has(id)) continue;
    out += collapsed.slice(from, marker.index) + chipOf(id);
    from = marker.index + marker[0].length;
    const url = URL_AFTER_MARKER.exec(collapsed.slice(from));
    if (url !== null) from += url[0].length;
  }
  return out + collapsed.slice(from);
}

/** 한 줄에서 인라인 코드를 피해 바꾼다 */
function linkLine(line: string, known: ReadonlyMap<string, WebSource>): string {
  let out = "";
  let from = 0;
  for (const span of line.matchAll(CODE_SPAN)) {
    out += linkPlain(line.slice(from, span.index), known) + span[0];
    from = span.index + span[0].length;
  }
  return out + linkPlain(line.slice(from), known);
}

/**
 * 답 마크다운의 출처 표식을 번호 칩 링크로 바꾼다. 출처가 없거나 표식이 없으면 글을 그대로 돌려준다.
 * 울타리 코드 블록 안 줄과 인라인 코드는 건드리지 않는다
 */
export function linkCitations(source: string, known: ReadonlyMap<string, WebSource>): string {
  if (known.size === 0 || !/\[s\d+\]/.test(source)) return source;
  let fence: { readonly char: string; readonly length: number } | null = null;
  return source
    .split("\n")
    .map((line) => {
      const run = FENCE.exec(line)?.[1];
      if (fence !== null) {
        if (
          run !== undefined &&
          run.charAt(0) === fence.char &&
          run.length >= fence.length &&
          line.trim() === run
        ) {
          fence = null;
        }
        return line;
      }
      if (run !== undefined) {
        fence = { char: run.charAt(0), length: run.length };
        return line;
      }
      return linkLine(line, known);
    })
    .join("\n");
}
