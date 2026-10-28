import type { ProviderSearchRequest } from "@xeon/contracts/capabilities";

// provider에 보낼 검색어 한 줄. 앞단이 푼 지시어(`ProviderSearchRequest.directives`)를 검색 엔진이 흔히 알아듣는 연산자로 되돌린다.
// 연산자는 결과를 줄이는 시도일 뿐이다. 네이티브 적용으로 알리지 않은 차원은 앞단이 결과에 다시 적용한다(L2.web.spec §4.8.5).

const MAX_QUERY_CHARS = 400;

export interface QueryTextOptions {
  /** `after:`, `before:`를 검색어에 넣는다. 날짜 연산자를 읽는 쪽(모델)에만 쓴다 */
  readonly includeDates: boolean;
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', " ").trim()}"`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 같은 연산자를 여러 번 쓰면 엔진이 AND로 읽어 결과가 비는 경우가 많다. 값이 하나일 때만 `site:`와 `filetype:`을 넣고,
 * 여러 개면 앞단 후처리 필터에 맡긴다.
 */
export function renderQueryText(request: ProviderSearchRequest, options: QueryTextOptions): string {
  const { directives } = request;
  const parts: string[] = [oneLine(request.terms)];
  for (const phrase of directives.phrases) parts.push(quoted(phrase));
  for (const word of directives.exclude) parts.push(`-${/\s/.test(word) ? quoted(word) : word}`);
  const [site, ...moreSites] = directives.site;
  if (site !== undefined && moreSites.length === 0) parts.push(`site:${site}`);
  for (const excluded of directives.excludeSite) parts.push(`-site:${excluded}`);
  const [filetype, ...moreTypes] = directives.filetype;
  if (filetype !== undefined && moreTypes.length === 0) parts.push(`filetype:${filetype}`);
  for (const title of directives.intitle) parts.push(`intitle:${quoted(title)}`);
  if (options.includeDates) {
    if (directives.after !== undefined) parts.push(`after:${directives.after}`);
    if (directives.before !== undefined) parts.push(`before:${directives.before}`);
  }
  return oneLine(parts.filter((part) => part !== "").join(" ")).slice(0, MAX_QUERY_CHARS);
}
