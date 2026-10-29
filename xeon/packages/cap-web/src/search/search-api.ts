import { err, ok, parse, type Result } from "@xeon/contracts";
import {
  IsoTimeSchema,
  WebSearch,
  type CallOptions,
  type Cost,
  type Passage,
  type ProviderSearchItem,
  type ProviderSearchRequest,
  type ProviderSearchResult,
  type SearchRelaxed,
  type Source,
  type WebCallMeta,
  type WebProviderFallback,
  type WebProviderManifest,
  type WebSearchInput,
  type WebSearchOutput,
  type WebSearchResult,
  type CacheUsage,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  createSearchMemo,
  limitBucket,
  searchMemoKey,
  type SearchMemo,
} from "../cache/search-memo.ts";
import { createSingleFlight } from "../cache/single-flight.ts";
import { buildMeta } from "../contract/meta.ts";
import { normalizeUrl } from "../contract/url.ts";
import { computeCost } from "../cost/meter.ts";
import type { WebDeps } from "../deps.ts";
import { guarded, invalidInput, type WebFailure } from "../errors.ts";
import { buildSource } from "../fetch/source.ts";
import type { SearchCandidate } from "../ports/providers.ts";
import { planChain, runChain, type ChainPlan } from "./chain.ts";
import { SEARXNG_JSON_DISABLED_WARNING } from "./providers/searxng.ts";
import {
  applyPostFilters,
  mergeFilters,
  parseSearchQuery,
  recencyCutoff,
  type FilterContext,
} from "./query.ts";

// L2.web.spec §4.1, §4.8. 처리 순서: 입력 검증 → 상한 → 외부 전송 마스킹 → 캐시 → 체인(provider 호출) → 정규화·후처리 필터
// → 비용 기록 → 메모 저장 → 메타. 같은 요청의 동시 호출은 provider 호출 하나를 공유한다(single-flight).

const DEFAULT_LIMIT = 10;
const MAX_PASSAGES = 10;

interface ShapedAnswer {
  readonly text: string;
  readonly citations: readonly { readonly url: string; readonly citedText: string | undefined }[];
}

/** provider 응답을 후처리 필터까지 거친 결과. 세션마다 달라지는 sN, 메타는 아직 없다(메모에 담긴다) */
interface Shaped {
  readonly items: readonly ProviderSearchItem[];
  readonly answer: ShapedAnswer | undefined;
  readonly relaxed: readonly SearchRelaxed[];
  readonly providerId: string;
  readonly cachePolicy: CacheUsage;
  readonly selectedBy: WebCallMeta["selectedBy"];
  readonly fallbacks: readonly WebProviderFallback[];
  readonly cost: Cost;
  /** 응답 자체에 붙는 경고(provider 경고, 필터 한계, 완화). 메모에서 꺼낸 호출에도 따라간다 */
  readonly stableWarnings: readonly string[];
  /** 이번 호출에서만 생긴 경고(가격표, 무료 한도) */
  readonly callWarnings: readonly string[];
}

type CacheState = WebCallMeta["cache"];

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal;
}

interface DomainFit {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  /** provider에 넘기지 못한 조건이 있어 앞단이 다시 걸러야 하는가 */
  readonly truncated: boolean;
}

/** provider의 도메인 필터 한계(`manifest.limits.domainFilter`)에 맞춰 넘길 수 있는 만큼만 넘긴다(§4.5.4) */
function fitDomains(
  manifest: WebProviderManifest,
  allow: readonly string[],
  deny: readonly string[],
): DomainFit {
  const limit = manifest.limits.domainFilter;
  if (limit === undefined) return { allow, deny, truncated: false };
  let keepAllow = allow;
  let keepDeny = deny;
  let truncated = false;
  if (!limit.mixAllowDeny && keepAllow.length > 0 && keepDeny.length > 0) {
    keepDeny = [];
    truncated = true;
  }
  if (keepAllow.length + keepDeny.length > limit.max) {
    const room = limit.max;
    keepAllow = keepAllow.slice(0, room);
    keepDeny = keepDeny.slice(0, Math.max(0, room - keepAllow.length));
    truncated = true;
  }
  return { allow: keepAllow, deny: keepDeny, truncated };
}

function toPassage(sourceId: string, passage: ProviderSearchItem["passages"][number]): Passage {
  const base: Passage = {
    sourceId,
    text: passage.text.slice(0, 20_000),
    kind: passage.kind,
  };
  return passage.score === undefined ? base : { ...base, score: passage.score };
}

/** 답변 인용의 itemIndex는 provider가 돌려준 원래 목록의 위치다. 후처리 필터와 무관하게 URL로 바꿔 둔다 */
function shapeAnswer(result: ProviderSearchResult): ShapedAnswer | undefined {
  if (result.answer === undefined) return undefined;
  const citations = result.answer.citations.flatMap((citation) => {
    const item = result.items[citation.itemIndex];
    return item === undefined ? [] : [{ url: item.url, citedText: citation.citedText }];
  });
  return { text: result.answer.text, citations };
}

function dedupe(items: readonly ProviderSearchItem[]): ProviderSearchItem[] {
  const seen = new Set<string>();
  const out: ProviderSearchItem[] = [];
  for (const item of items) {
    const normalized = normalizeUrl(item.url);
    const key = normalized.ok ? normalized.value : item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function textLength(
  items: readonly ProviderSearchItem[],
  answer: ShapedAnswer | undefined,
): number {
  let total = answer?.text.length ?? 0;
  for (const item of items) {
    total += (item.title ?? "").length;
    for (const passage of item.passages) total += passage.text.length;
  }
  return total;
}

export function createSearchApi(deps: WebDeps): {
  readonly search: (input: WebSearchInput, options?: CallOptions) => Promise<WebSearchOutput>;
} {
  const memo: SearchMemo<Shaped> = createSearchMemo<Shaped>(deps.clock);
  const flight = createSingleFlight<Result<Shaped, WebFailure>>();
  /** SearXNG JSON 꺼짐 안내를 이미 낸 대화(스레드가 없는 호출은 빈 문자열 하나). 대화마다 한 번만 안내한다(§4.8.3) */
  const jsonDisabledNoticed = new Set<string>();

  /** 이 호출에서만 붙는 안내. 체인에서 SearXNG가 `json-disabled`로 내려갔으면 대화마다 한 번 알린다 */
  function noticesOf(shaped: Shaped, threadId: ThreadId | undefined): readonly string[] {
    if (!shaped.fallbacks.some((fallback) => fallback.reason === "json-disabled")) return [];
    const key = threadId ?? "";
    if (jsonDisabledNoticed.has(key)) return [];
    jsonDisabledNoticed.add(key);
    return [SEARXNG_JSON_DISABLED_WARNING];
  }

  /** provider 호출을 마치고 후처리 필터를 적용한 결과를 만든다 */
  async function execute(
    candidates: readonly SearchCandidate[],
    plan: ChainPlan,
    request: ProviderSearchRequest,
    context: FilterContext,
    signal: AbortSignal,
    fitFor: (manifest: WebProviderManifest) => DomainFit,
  ): Promise<Result<Shaped, WebFailure>> {
    const ran = await runChain(deps, candidates, plan, request, signal);
    if (!ran.ok) return ran;
    const { candidate, result } = ran.value;
    const manifest = candidate.provider.manifest;
    const native = new Set(result.appliedNatively);
    // 요청의 도메인 조건은 첫 후보의 한계에 맞춰 만들었다. 다른 후보가 답했거나 조건을 다 넘기지 못했으면 앞단이 다시 건다
    const limited = fitFor(manifest).truncated;
    if (limited || candidate.provider.id !== plan.order[0]) native.delete("domains");
    const deduped = dedupe(result.items);
    const filtered = applyPostFilters(deduped, context, native);
    const stableWarnings = [...result.warnings];
    if (limited) stableWarnings.push(`domain_filter_limited:${candidate.provider.id}`);
    if (filtered.relaxed.length > 0)
      stableWarnings.push(`filters_relaxed:${filtered.relaxed.join(",")}`);
    const answer = shapeAnswer(result);
    const priced = computeCost(
      {
        provider: candidate.provider.id,
        pricing: manifest.pricing,
        ...(result.cost === undefined ? {} : { reported: result.cost }),
        units: [{ name: "search", count: 1 }],
        contextChars: textLength(filtered.items, answer),
      },
      deps.clock.now(),
    );
    const callWarnings = [...priced.warnings];
    if (deps.meter !== undefined) {
      const recorded = deps.meter.record(candidate.provider.id, priced.cost, manifest.pricing);
      if (recorded.ok) callWarnings.push(...recorded.value);
      else deps.logger.warn("web.usage_record_failed", { kind: recorded.error.kind });
    }
    const shaped: Shaped = {
      items: filtered.items,
      answer,
      relaxed: filtered.relaxed,
      providerId: candidate.provider.id,
      cachePolicy: candidate.cachePolicy,
      selectedBy: ran.value.selectedBy,
      fallbacks: ran.value.fallbacks,
      cost: priced.cost,
      stableWarnings,
      callWarnings,
    };
    return ok(shaped);
  }

  /** 세션의 sN과 메타를 붙여 호출자에게 돌려줄 출력으로 만든다 */
  function assemble(
    shaped: Shaped,
    limit: number,
    content: WebSearchInput["content"],
    threadId: ThreadId | undefined,
    table: Awaited<ReturnType<WebDeps["sourceIds"]["forThread"]>>,
    cache: CacheState,
    startedAt: number,
    fromMemo: boolean,
    notices: readonly string[],
  ): Result<WebSearchOutput, WebFailure> {
    if (!table.ok) {
      return err({
        code: "unavailable",
        message: "The session history could not be read.",
        retryable: true,
        detail: { reason: table.error.kind },
      });
    }
    const now = deps.clock.now();
    const sources = new Map<string, Source>();
    const results: WebSearchResult[] = [];
    const idByUrl = new Map<string, string>();
    for (const item of shaped.items.slice(0, limit)) {
      const id = table.value.idFor(item.url);
      if (!id.ok)
        return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
      idByUrl.set(item.url, id.value);
      const published =
        item.publishedAt === undefined ? undefined : parse(IsoTimeSchema, item.publishedAt);
      const source = buildSource({
        id: id.value,
        url: item.url,
        finalUrl: undefined,
        title: item.title,
        publishedAt: item.publishedAt,
        provider: shaped.providerId,
        cache: shaped.cachePolicy,
        rawSha256: undefined,
        rawRef: undefined,
        retrievedAtMs: now,
      });
      if (!sources.has(id.value)) sources.set(id.value, source);
      const passages: Passage[] =
        content === "none"
          ? []
          : item.passages.slice(0, MAX_PASSAGES).map((passage) => toPassage(id.value, passage));
      results.push({
        rank: results.length + 1,
        sourceId: id.value,
        url: item.url.slice(0, 4096),
        ...(item.title === undefined ? {} : { title: item.title.slice(0, 512) }),
        ...(published?.ok === true ? { publishedAt: published.value } : {}),
        passages,
      });
    }
    const answer =
      shaped.answer === undefined
        ? undefined
        : {
            text: shaped.answer.text.slice(0, 20_000),
            citations: shaped.answer.citations.flatMap((citation) => {
              const sourceId = idByUrl.get(citation.url);
              return sourceId === undefined
                ? []
                : [
                    {
                      sourceId,
                      ...(citation.citedText === undefined
                        ? {}
                        : { citedText: citation.citedText.slice(0, 300) }),
                    },
                  ];
            }),
          };
    if (threadId !== undefined)
      deps.seen.note(
        threadId,
        results.map((result) => result.url),
      );
    const cost = fromMemo
      ? computeCost(
          {
            provider: shaped.providerId,
            pricing: "free",
            units: [],
            contextChars: textLength(shaped.items, shaped.answer),
          },
          now,
        ).cost
      : shaped.cost;
    return ok({
      results,
      sources: [...sources.values()],
      ...(answer === undefined ? {} : { answer }),
      ...(shaped.relaxed.length === 0 ? {} : { relaxed: [...shaped.relaxed] }),
      meta: buildMeta({
        ids: deps.ids,
        clock: deps.clock,
        startedAt,
        provider: shaped.providerId,
        selectedBy: shaped.selectedBy,
        fallbacks: fromMemo ? [] : shaped.fallbacks,
        cache,
        cost,
        warnings: fromMemo
          ? [...shaped.stableWarnings, ...notices]
          : [...shaped.stableWarnings, ...shaped.callWarnings, ...notices],
      }),
    });
  }

  async function run(
    input: WebSearchInput,
    options: CallOptions | undefined,
  ): Promise<Result<WebSearchOutput, WebFailure>> {
    const startedAt = deps.clock.now();
    const context = options?.context;
    const threadId = context?.threadId;
    const signal = options?.signal ?? neverAbortedSignal();
    const settings = deps.settings(threadId);
    const query = input.query.trim();
    if (query === "") return err(invalidInput("The query is empty."));
    const leaked = deps.access.checkOutboundText(`${input.query}\n${input.objective ?? ""}`);
    if (leaked !== undefined) return err(leaked);
    const limited = deps.limits.take("search", threadId, 1, settings.limits.searchPerSession);
    if (limited !== undefined) return err(limited);

    const parsed = parseSearchQuery(query);
    const providerTerms = parsed.terms !== "" ? parsed.terms : parsed.directives.phrases.join(" ");
    if (providerTerms === "") {
      return err(invalidInput("The query has no search words besides directives."));
    }
    const merged = mergeFilters(parsed, input.domains, settings.policy.deny);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const bucket = limitBucket(limit);
    const freshness = input.freshness ?? "cached-ok";
    const contentMode = input.content ?? "snippets";
    const candidates = deps.catalog.searchCandidates();
    const plan = planChain(
      candidates,
      input.provider,
      settings.search.provider,
      settings.search.order,
    );
    const filterContext: FilterContext = {
      merged,
      recencyAfter:
        input.recency === undefined ? undefined : recencyCutoff(input.recency, deps.clock.now()),
    };
    const table = await deps.sourceIds.forThread(threadId);

    const key = searchMemoKey({
      chain: plan.order,
      query: JSON.stringify([providerTerms, parsed.directives]),
      objective: input.objective,
      recency: input.recency,
      domains: merged.domains,
      content: contentMode,
      limitBucket: bucket,
    });
    const ttlMs = settings.cache.searchTtlMinutes * 60_000;

    const existing = freshness === "live" ? undefined : memo.lookup(key);
    let state: CacheState = freshness === "live" ? "bypass" : "miss";
    if (existing !== undefined) {
      if (freshness === "prefer-fresh" && existing.ageMs > existing.ttlMs / 2) {
        state = "stale-revalidated";
      } else {
        return assemble(
          existing.value,
          limit,
          contentMode,
          threadId,
          table,
          "hit",
          startedAt,
          true,
          [],
        );
      }
    }

    // 도메인 필터 한계에 맞춘 요청은 provider마다 다르다. 첫 후보의 한계를 쓰고, 넘기지 못한 조건은 앞단이 다시 건다
    const fitFor = (manifest: WebProviderManifest): DomainFit =>
      fitDomains(manifest, merged.domains.allow, merged.domains.deny);
    const firstId = plan.order[0];
    const firstManifest = candidates.find((candidate) => candidate.provider.id === firstId)
      ?.provider.manifest;
    const fit =
      firstManifest === undefined
        ? { allow: merged.domains.allow, deny: merged.domains.deny, truncated: false }
        : fitFor(firstManifest);
    const request: ProviderSearchRequest = {
      terms: providerTerms,
      directives: merged.directives,
      ...(input.objective === undefined ? {} : { objective: input.objective }),
      limit: bucket,
      ...(input.recency === undefined ? {} : { recency: input.recency }),
      domains: { allow: fit.allow, deny: fit.deny },
      content: contentMode,
      freshness,
    };

    const shared = await flight.run(
      `${key}|${freshness}`,
      () => execute(candidates, plan, request, filterContext, signal, fitFor),
      { signal, wasCancelled: (value) => !value.ok && value.error.code === "aborted" },
    );
    if (!shared.ok) return shared;
    const shaped = shared.value;
    const answeredFirst = shaped.providerId === firstId;
    if (freshness !== "live" && shaped.cachePolicy !== "none" && answeredFirst && ttlMs > 0) {
      memo.store(key, shaped, ttlMs);
    }
    return assemble(
      shaped,
      limit,
      contentMode,
      threadId,
      table,
      state,
      startedAt,
      false,
      noticesOf(shaped, threadId),
    );
  }

  return {
    search: (input, options) => guarded(WebSearch.id, "search", () => run(input, options)),
  };
}
