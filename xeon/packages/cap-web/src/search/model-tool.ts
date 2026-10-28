import { assertNever } from "@xeon/contracts";
import type { ProviderSearchItem } from "@xeon/contracts/capabilities";
import type { HostedSearchResponse } from "@xeon/contracts/services";
import { normalizeUrl } from "../contract/url.ts";
import type { SearchCandidate } from "../ports/providers.ts";

// L2.web.spec §4.8.1 ① 모델용 도구 경로. `cap-web`은 판정 함수만 제공한다(순수). hosted 서버 도구를 요청에 넣는 일,
// `encrypted_content` 반송, `pause_turn` 처리는 L1.models가 한다. 판정은 세션 첫 턴에 한 번 하고 세션 동안 고정한다.

export type ModelSearchSetting = "auto" | "hosted" | "function" | "off";
export type ModelSearchTool = "hosted" | "function" | "off";

export interface ModelToolInput {
  /** `l2.web.search.modelTool` */
  readonly setting: ModelSearchSetting;
  /** auto 체인의 첫 후보가 내장 래퍼뿐인가(키를 등록한 플러그인도 주소를 설정한 SearXNG도 없다) */
  readonly wrapperOnlyChain: boolean;
  /** 현재 모델 provider·모델에 hosted 검색 서버 도구가 있는가 */
  readonly hostedSupported: boolean;
}

/**
 * auto 체인의 후보가 내장 래퍼뿐인가. `catalog.searchCandidates()`가 돌려준 목록(설정하지 않은 SearXNG는 이미 빠져 있다)을 넘긴다.
 * 키를 등록한 플러그인이나 주소를 설정한 SearXNG가 하나라도 있으면 거짓이고, 후보가 비어 있어도 거짓이다
 */
export function isWrapperOnlyChain(candidates: readonly SearchCandidate[]): boolean {
  return candidates.length > 0 && candidates.every((candidate) => candidate.origin === "builtin");
}

/**
 * - off: 도구를 광고하지 않는다.
 * - function: `web_search` 함수 도구만 광고한다(앞단 체인).
 * - hosted: 모델 provider의 내장 서버 도구. 현재 모델이 지원하지 않으면 function으로 내려간다.
 * - auto: 체인이 래퍼뿐이고 hosted를 지원하면 hosted(검색마다 모델 호출이 하나 더 드는 일을 피한다), 아니면 function.
 */
export function decideModelSearchTool(input: ModelToolInput): ModelSearchTool {
  switch (input.setting) {
    case "off":
      return "off";
    case "function":
      return "function";
    case "hosted":
      return input.hostedSupported ? "hosted" : "function";
    case "auto":
      return input.wrapperOnlyChain && input.hostedSupported ? "hosted" : "function";
    default:
      return assertNever(input.setting, "ModelSearchSetting");
  }
}

// ── hosted 검색 결과의 정규화 ────────────────────────────────────────────────

const MAX_CITED_TEXT_CHARS = 2000;
const MAX_HOSTED_ITEMS = 60;
const MONTHS: readonly string[] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** 월 이름이나 세 글자 이상의 앞부분(`Sep`, `Sept`)을 1~12로. 모르면 undefined */
function monthNumberOf(name: string): number | undefined {
  const lowered = name.toLowerCase();
  if (lowered.length < 3) return undefined;
  const index = MONTHS.findIndex((month) => month.startsWith(lowered));
  return index === -1 ? undefined : index + 1;
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * provider가 준 `page_age`(예: `April 30, 2025`, `2025-04-30`)를 `YYYY-MM-DD`로 읽는다. 읽지 못하는 표현
 * (`2 days ago` 같은 상대 표현, 모르는 형식)은 undefined다. 시각은 없고 날짜만 있으므로 시간대를 가정하지 않는다.
 */
export function publishedDateOfPageAge(pageAge: string | null): string | undefined {
  if (pageAge === null) return undefined;
  const text = pageAge.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
  if (iso !== null) return `${iso[1] ?? ""}-${iso[2] ?? ""}-${iso[3] ?? ""}`;
  const named = /^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (named === null) return undefined;
  const month = monthNumberOf(named[1] ?? "");
  const day = Number(named[2]);
  const year = Number(named[3]);
  if (month === undefined || day < 1 || day > 31) return undefined;
  return `${String(year)}-${twoDigits(month)}-${twoDigits(day)}`;
}

interface Draft {
  readonly url: string;
  title: string | undefined;
  publishedAt: string | undefined;
  readonly passages: string[];
}

function itemOfDraft(draft: Draft): ProviderSearchItem {
  return {
    url: draft.url,
    ...(draft.title === undefined ? {} : { title: draft.title }),
    ...(draft.publishedAt === undefined ? {} : { publishedAt: draft.publishedAt }),
    passages: draft.passages.map((text) => ({ text, kind: "snippet" as const })),
  };
}

/**
 * hosted 검색 응답(들)을 `ProviderSearchItem`으로 바꾼다. 순수 함수다(L2.web.spec §4.8.1, §4.8.4 5번).
 * - 결과 블록(`web_search_tool_result`)의 url, title, page_age가 항목이 된다.
 * - 인용 블록(`web_search_result_location`)의 `cited_text`는 같은 URL 항목의 `snippet` 구절이 된다. 결과에 없는 URL의
 *   인용은 구절만 있는 항목으로 더한다.
 * - `encrypted_content`, `encrypted_index`는 포트가 이미 빼고 주므로 담을 곳이 없다.
 * 같은 URL(정규화 기준)은 한 항목으로 합치고, 순서는 처음 나온 순서를 지킨다. `pause_turn` 이어 요청의 응답은 순서대로 넘긴다.
 */
export function normalizeHostedSearch(
  responses: readonly HostedSearchResponse[],
): readonly ProviderSearchItem[] {
  const drafts = new Map<string, Draft>();
  const draftOf = (url: string, title: string | null): Draft => {
    const normalized = normalizeUrl(url);
    const key = normalized.ok ? normalized.value : url;
    const known = drafts.get(key);
    if (known !== undefined) {
      if (known.title === undefined && title !== null && title !== "") known.title = title;
      return known;
    }
    const created: Draft = {
      url,
      title: title === null || title === "" ? undefined : title,
      publishedAt: undefined,
      passages: [],
    };
    drafts.set(key, created);
    return created;
  };
  for (const response of responses) {
    for (const hit of response.results) {
      const draft = draftOf(hit.url, hit.title);
      const published = publishedDateOfPageAge(hit.pageAge);
      if (draft.publishedAt === undefined && published !== undefined) draft.publishedAt = published;
    }
    for (const citation of response.citations) {
      const draft = draftOf(citation.url, citation.title);
      const text = citation.citedText?.replace(/\s+/g, " ").trim() ?? "";
      if (text !== "" && !draft.passages.includes(text)) {
        draft.passages.push(text.slice(0, MAX_CITED_TEXT_CHARS));
      }
    }
  }
  return [...drafts.values()].slice(0, MAX_HOSTED_ITEMS).map(itemOfDraft);
}
