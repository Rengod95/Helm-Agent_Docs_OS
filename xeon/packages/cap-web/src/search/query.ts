import type {
  NativeFilterDimension,
  ProviderSearchItem,
  Recency,
  SearchDirectives,
  SearchRelaxed,
} from "@xeon/contracts/capabilities";
import { matchDomain } from "../policy/domain.ts";

// L2.web.spec §4.8.5. omp 방식의 쿼리 지시어 파서와 후처리 필터. 지시어는 앞단이 풀고 provider에는 정규화한 요청을 준다.
// 순수 함수다. 시각은 호출자가 넘긴다(주입한 Clock).

export interface ParsedQuery {
  /** 지시어를 뺀 나머지 단어(OR 포함) */
  readonly terms: string;
  readonly directives: SearchDirectives;
}

interface Token {
  readonly text: string;
  readonly quoted: boolean;
  /** 따옴표 안이 아닌 앞쪽의 `-` 접두 */
  readonly negated: boolean;
  /** `key:` 접두(따옴표 값 포함) */
  readonly key: string | undefined;
}

const DATE_VALUE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DIRECTIVE_KEYS: ReadonlySet<string> = new Set([
  "site",
  "after",
  "before",
  "filetype",
  "intitle",
]);

/** 공백으로 나누되 따옴표 구간(`"a b"`, `intitle:"a b"`, `-"a b"`)은 한 토큰으로 둔다 */
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < query.length) {
    while (index < query.length && /\s/.test(query.charAt(index))) index += 1;
    if (index >= query.length) break;
    let negated = false;
    if (
      query.charAt(index) === "-" &&
      index + 1 < query.length &&
      !/\s/.test(query.charAt(index + 1))
    ) {
      negated = true;
      index += 1;
    }
    let key: string | undefined;
    const keyMatch = /^([a-z]+):/.exec(query.slice(index));
    if (keyMatch !== null && DIRECTIVE_KEYS.has(keyMatch[1] ?? "")) {
      key = keyMatch[1];
      index += keyMatch[0].length;
    }
    if (query.charAt(index) === '"') {
      const close = query.indexOf('"', index + 1);
      const end = close === -1 ? query.length : close;
      tokens.push({ text: query.slice(index + 1, end), quoted: true, negated, key });
      index = close === -1 ? query.length : close + 1;
      continue;
    }
    let end = index;
    while (end < query.length && !/\s/.test(query.charAt(end))) end += 1;
    tokens.push({ text: query.slice(index, end), quoted: false, negated, key });
    index = end;
  }
  return tokens;
}

function normalizeSite(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\*\./, "")
    .replace(/\.$/, "");
}

/** `site:`, `-site:`, `after:`, `before:`, `filetype:`, `intitle:`, `"구절"`, `-제외어`를 뽑는다. 나머지는 terms에 남긴다 */
export function parseSearchQuery(query: string): ParsedQuery {
  const site: string[] = [];
  const excludeSite: string[] = [];
  const filetype: string[] = [];
  const intitle: string[] = [];
  const phrases: string[] = [];
  const exclude: string[] = [];
  const terms: string[] = [];
  let after: string | undefined;
  let before: string | undefined;
  for (const token of tokenize(query)) {
    const text = token.text.trim();
    if (text === "") continue;
    if (token.key === "site") {
      const host = normalizeSite(text);
      if (host === "") continue;
      (token.negated ? excludeSite : site).push(host);
    } else if (token.key === "after" || token.key === "before") {
      if (DATE_VALUE.test(text) && !token.negated) {
        if (token.key === "after") after = text;
        else before = text;
      } else {
        terms.push(token.quoted ? `"${text}"` : `${token.negated ? "-" : ""}${token.key}:${text}`);
      }
    } else if (token.key === "filetype") {
      filetype.push(text.toLowerCase().replace(/^\./, ""));
    } else if (token.key === "intitle") {
      intitle.push(text);
    } else if (token.negated) {
      exclude.push(text);
    } else if (token.quoted) {
      phrases.push(text);
    } else {
      terms.push(text);
    }
  }
  return {
    terms: terms.join(" "),
    directives: {
      site,
      excludeSite,
      ...(after === undefined ? {} : { after }),
      ...(before === undefined ? {} : { before }),
      filetype,
      intitle,
      phrases,
      exclude,
    },
  };
}

const RECENCY_DAYS: Readonly<Record<Recency, number>> = { day: 1, week: 7, month: 30, year: 365 };

/** recency를 YYYY-MM-DD 하한으로 바꾼다(day 1, week 7, month 30, year 365일 전) [제안] */
export function recencyCutoff(recency: Recency, nowMs: number): string {
  return new Date(nowMs - RECENCY_DAYS[recency] * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 쿼리 지시어와 호출 인자의 합. provider에 줄 `SearchDirectives`와 후처리에 쓸 조건 */
export interface MergedFilters {
  readonly directives: SearchDirectives;
  /** 호출 `domains`와 정책 deny에서 온 조건. 완화하지 않는다 */
  readonly domains: { readonly allow: readonly string[]; readonly deny: readonly string[] };
}

export function mergeFilters(
  parsed: ParsedQuery,
  domains:
    | {
        readonly allow?: readonly string[] | undefined;
        readonly deny?: readonly string[] | undefined;
      }
    | undefined,
  policyDeny: readonly string[],
): MergedFilters {
  const allow = [...new Set(domains?.allow ?? [])];
  const deny = [...new Set([...(domains?.deny ?? []), ...policyDeny])];
  return { directives: parsed.directives, domains: { allow, deny } };
}

export type FilterDimension = NativeFilterDimension;

function hostOf(url: string): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  return match?.[1]
    ?.toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function siteMatches(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

function itemText(item: ProviderSearchItem): string {
  return [item.title ?? "", ...item.passages.map((passage) => passage.text)]
    .join("\n")
    .toLowerCase();
}

function dateOf(item: ProviderSearchItem): string | undefined {
  return item.publishedAt?.slice(0, 10);
}

export interface FilterContext {
  readonly merged: MergedFilters;
  /** recency 하한(YYYY-MM-DD). recency 인자가 없으면 undefined */
  readonly recencyAfter: string | undefined;
}

/** 항목 하나가 적용할 차원의 조건을 모두 만족하는가 */
function keeps(
  item: ProviderSearchItem,
  context: FilterContext,
  dimensions: ReadonlySet<FilterDimension>,
): boolean {
  const { directives, domains } = context.merged;
  const host = hostOf(item.url);
  if (dimensions.has("domains")) {
    if (
      domains.allow.length > 0 &&
      (host === undefined ||
        !domains.allow.some((p) => matchDomain(p, host) || siteMatches(host, p)))
    ) {
      return false;
    }
    if (host !== undefined && domains.deny.some((pattern) => matchDomain(pattern, host)))
      return false;
  }
  if (dimensions.has("site")) {
    if (
      directives.site.length > 0 &&
      (host === undefined || !directives.site.some((site) => siteMatches(host, site)))
    ) {
      return false;
    }
    if (host !== undefined && directives.excludeSite.some((site) => siteMatches(host, site)))
      return false;
  }
  if (dimensions.has("filetype") && directives.filetype.length > 0) {
    const path = item.url.split(/[?#]/)[0]?.toLowerCase() ?? "";
    if (!directives.filetype.some((ext) => path.endsWith(`.${ext}`))) return false;
  }
  const text = itemText(item);
  if (dimensions.has("intitle")) {
    const title = (item.title ?? "").toLowerCase();
    if (!directives.intitle.every((word) => title.includes(word.toLowerCase()))) return false;
  }
  if (
    dimensions.has("phrase") &&
    !directives.phrases.every((phrase) => text.includes(phrase.toLowerCase()))
  ) {
    return false;
  }
  if (
    dimensions.has("exclude") &&
    directives.exclude.some((word) => text.includes(word.toLowerCase()))
  ) {
    return false;
  }
  const published = dateOf(item);
  if (dimensions.has("date") && published !== undefined) {
    if (directives.after !== undefined && published < directives.after) return false;
    if (directives.before !== undefined && published > directives.before) return false;
  }
  if (dimensions.has("recency") && published !== undefined && context.recencyAfter !== undefined) {
    if (published < context.recencyAfter) return false;
  }
  return true;
}

/** 완화 순서(§4.8.5): exclude → phrase → intitle → filetype → date → recency → site. domains는 완화하지 않는다 */
const RELAX_ORDER: readonly SearchRelaxed[] = [
  "exclude",
  "phrase",
  "intitle",
  "filetype",
  "date",
  "recency",
  "site",
];

export interface FilterOutcome {
  readonly items: readonly ProviderSearchItem[];
  readonly relaxed: readonly SearchRelaxed[];
  /** 후처리로 걸러낸 항목이 하나라도 있었는가 */
  readonly filtered: boolean;
}

/**
 * 후처리 필터. 결과가 모두 없어지면 정해진 순서로 한 차원씩 더 완화하며 다시 걸러, 결과가 생기는 첫 단계에서 멈춘다.
 * 완화한 차원 이름은 `relaxed`에 넣는다. 원래 결과가 비어 있으면 완화하지 않는다.
 */
export function applyPostFilters(
  items: readonly ProviderSearchItem[],
  context: FilterContext,
  native: ReadonlySet<FilterDimension>,
): FilterOutcome {
  const all: readonly FilterDimension[] = [
    "domains",
    "site",
    "filetype",
    "intitle",
    "phrase",
    "exclude",
    "date",
    "recency",
  ];
  const active = new Set<FilterDimension>(all.filter((dimension) => !native.has(dimension)));
  const first = items.filter((item) => keeps(item, context, active));
  if (first.length > 0 || items.length === 0) {
    return { items: first, relaxed: [], filtered: first.length !== items.length };
  }
  const relaxed: SearchRelaxed[] = [];
  for (const dimension of RELAX_ORDER) {
    if (!active.has(dimension)) continue;
    active.delete(dimension);
    relaxed.push(dimension);
    const next = items.filter((item) => keeps(item, context, active));
    if (next.length > 0) return { items: next, relaxed, filtered: true };
  }
  // 어느 단계로도 결과가 생기지 않으면 완화는 소용이 없었으므로 기록하지 않는다
  return { items: [], relaxed: [], filtered: true };
}
