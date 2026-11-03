import type { ToolsWebView, WebSection, WebToolRow } from "@fresnel/client";

// 도구와 웹 화면(P-12)의 순수 모델. SearXNG는 없앴다([결정: 2026-11-04 사용자 B15]): 엔진과 클라이언트에는 SearXNG 코드가 없지만,
// 화면이 받는 값에 그 id나 이름이 있으면 행과 순서에서 뺀다. 설정 값이 SearXNG를 고정했으면 자동 선택으로 보인다.

const REMOVED_PROVIDER = /searxng/i;

/** 화면에서 없애는 provider인가. id와 표시 이름 어느 쪽이든 SearXNG를 가리키면 참이다 */
export function isRemovedProvider(row: Pick<WebToolRow, "id" | "displayName">): boolean {
  return REMOVED_PROVIDER.test(row.id) || REMOVED_PROVIDER.test(row.displayName);
}

function sectionWithout(section: WebSection): WebSection {
  return {
    ...section,
    provider: REMOVED_PROVIDER.test(section.provider) ? "auto" : section.provider,
    order: section.order.filter((id) => !REMOVED_PROVIDER.test(id)),
    rows: section.rows.filter((row) => !isRemovedProvider(row)),
  };
}

/** 화면이 쓰는 도구와 웹 값. SearXNG 행, 순서, 고정, 고지 id를 뺀 복사본이다 */
export function visibleWebViewOf(view: ToolsWebView): ToolsWebView {
  return {
    ...view,
    search: sectionWithout(view.search),
    browse: sectionWithout(view.browse),
    fetch: sectionWithout(view.fetch),
    noticesPending: view.noticesPending.filter((id) => !REMOVED_PROVIDER.test(id)),
  };
}

/** 행 한 줄의 상태. 쓸 수 있으면 준비됨, 키가 없으면 키 필요, 그 밖의 사유는 쓸 수 없음이다 */
export type ProviderState = "ready" | "needs-key" | "unavailable";

export function providerStateOf(row: Pick<WebToolRow, "ok" | "reason">): ProviderState {
  if (row.ok) return "ready";
  return row.reason === "no-key" ? "needs-key" : "unavailable";
}

/**
 * 화면에 보이는 검색 순서. 저장된 순서에서 보이는 id를 먼저 중복 없이 두고, 나머지 행은 행 순서(자동 순위)대로 붙인다.
 * 저장된 순서가 비었으면 자동 순위 그대로다.
 */
export function displayOrderOf(section: WebSection): readonly string[] {
  const visible = section.rows.map((row) => row.id);
  const stored = section.order.filter(
    (id, index) => visible.includes(id) && section.order.indexOf(id) === index,
  );
  const rest = visible.filter((id) => !stored.includes(id));
  return [...stored, ...rest];
}

/** 설정이 고정한 provider id. 자동이면 `null`이다 */
export function pinnedOf(section: WebSection): string | null {
  return section.provider === "auto" ? null : section.provider;
}
