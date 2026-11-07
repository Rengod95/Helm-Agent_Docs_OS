import { estimateTokens } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { MemoryEntry, MemoryStoreView } from "@fresnel/contracts/capabilities";

// 설정 "대화와 컨텍스트"의 기억 구역 순수 모델. 구역 안 찾기와 정렬, 문맥 토큰 어림, 설정 찾기가 이 구역을 고르는지를 값으로 만든다.
// 입력은 엔진이 준 항목(`MemoryEntry`)과 찾는 글뿐이다. 호스트를 부르지 않고 DOM도 보지 않는다.
// 항목에는 날짜와 출처가 없다(데이터에 없다). 파일 순서는 넣은 순서라 뒤에 있는 글이 새 글이다.

/** 구역 안 정렬. `recent`는 최근 것부터, `name`은 글 이름순이다 */
export type MemorySort = "recent" | "name";

export const MEMORY_SORTS: readonly MemorySort[] = ["recent", "name"];

/**
 * 구역 이름(번역 문장, 호출하는 쪽이 넘긴다)과 함께 설정 찾기가 구역에 맞추는 영문 이름. 한글 구역 이름은 카탈로그에서 오므로 여기에 두지 않는다.
 * 영문 로케일에서도 "memory"로 같은 구역을 찾는다
 */
const MEMORY_SEARCH_WORDS: readonly string[] = ["memory"];

/** 행에 보이는 글. 줄바꿈과 연속 공백은 한 칸으로 보인다. 찾기와 정렬도 이 글을 본다 */
export function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 찾는 글을 행과 같은 줄 모양으로 줄이고 소문자로 맞춘다. 빈 찾기면 빈 글이다 */
function needleOf(query: string): string {
  return previewOf(query).toLocaleLowerCase();
}

/** 찾는 글을 포함한 항목만 남긴다. 줄 모양과 대소문자는 무시하고 순서는 그대로다. 빈 찾기는 모두 남긴다 */
export function filterEntries(
  entries: readonly MemoryEntry[],
  query: string,
): readonly MemoryEntry[] {
  const needle = needleOf(query);
  if (needle === "") return entries;
  return entries.filter((entry) => previewOf(entry.text).toLocaleLowerCase().includes(needle));
}

/**
 * 항목을 정렬한 새 배열을 돌려준다. 원본은 그대로다. `recent`는 파일 순서를 뒤집고, `name`은 행 글을 `locale`로 비교한다.
 * 이름이 같으면 파일 순서를 지킨다(안정 정렬).
 */
export function sortEntries(
  entries: readonly MemoryEntry[],
  sort: MemorySort,
  locale: string,
): readonly MemoryEntry[] {
  switch (sort) {
    case "recent":
      return entries.toReversed();
    case "name":
      return entries.toSorted((a, b) => previewOf(a.text).localeCompare(previewOf(b.text), locale));
    default:
      return assertNever(sort, "MemorySort");
  }
}

/**
 * 문맥에 드는 토큰 어림. 두 묶음이 쓴 글자 수를 더해 `estimateTokens`(글자 수 / 4를 올림)로 잰다.
 * 모델 호출 쪽 추정과 같은 셈이라 설정 화면의 값과 문맥 크기가 같은 잣대를 쓴다.
 */
export function tokensOf(stores: readonly Pick<MemoryStoreView, "usedChars">[]): number {
  return estimateTokens(stores.reduce((sum, store) => sum + store.usedChars, 0));
}

/** 찾는 글이 구역 이름(번역 문장)이나 "기억", "memory"에 드는가. 빈 찾기는 맞지 않는다 */
function labelMatches(query: string, label: string): boolean {
  const needle = needleOf(query);
  if (needle === "") return false;
  return [label, ...MEMORY_SEARCH_WORDS].some((word) =>
    previewOf(word).toLocaleLowerCase().includes(needle),
  );
}

/** 찾는 글이 어느 저장소의 글에라도 드는가 */
function anyEntryMatches(stores: readonly MemoryStoreView[], query: string): boolean {
  return stores.some((store) => filterEntries(store.entries, query).length > 0);
}

/**
 * 찾는 글이 구역 이름에만 맞는가. 구역 이름이 맞고 어느 저장소의 글에도 들지 않으면 참이다.
 * 그때 설정 찾기의 기억 구역은 모든 글을 보인다(구역을 찾은 것이지 글을 찾은 것이 아니다).
 */
export function labelOnlyOf(
  stores: readonly MemoryStoreView[],
  query: string,
  label: string,
): boolean {
  return labelMatches(query, label) && !anyEntryMatches(stores, query);
}

/** 설정 찾기 결과에 보일 글. 구역 이름만 맞으면(`labelOnly`) 모든 글이고, 아니면 찾는 글이 든 글만이다 */
export function findEntriesOf(
  entries: readonly MemoryEntry[],
  query: string,
  labelOnly: boolean,
): readonly MemoryEntry[] {
  return labelOnly ? entries : filterEntries(entries, query);
}

/**
 * 설정 찾기가 기억 구역을 고르는가. 찾는 글이 구역 이름에 맞거나 어느 저장소의 글에 들면 맞는다.
 * 값을 아직 못 읽었으면(`stores`가 null) 맞지 않는다. 빈 찾기는 읽은 뒤에 맞는다(`fieldMatches`와 같다).
 */
export function matchesQuery(
  query: string,
  input: { readonly label: string; readonly stores: readonly MemoryStoreView[] | null },
): boolean {
  const { label, stores } = input;
  if (stores === null) return false;
  if (needleOf(query) === "") return true;
  return labelMatches(query, label) || anyEntryMatches(stores, query);
}
