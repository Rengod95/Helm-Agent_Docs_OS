import { err, ok, type Result } from "@xeon/contracts";
import {
  WebFetch,
  type CacheUsage,
  type CallOptions,
  type Cost,
  type FetchFormat,
  type ProviderFetchResult,
  type Freshness,
  type RenderMode,
  type WebCallMeta,
  type WebFetchInput,
  type WebFetchOutput,
  type WebFetchPage,
  type WebProviderFallback,
} from "@xeon/contracts/capabilities";
import { buildMeta, NO_COST } from "../contract/meta.ts";
import type { SourceIdTable } from "../contract/source-ids.ts";
import { normalizeUrl } from "../contract/url.ts";
import { cacheKeyOf, type CachedPage } from "../cache/fetch-cache.ts";
import { computeCost } from "../cost/meter.ts";
import type { ProviderPricing } from "../cost/pricing.ts";
import type { WebDeps } from "../deps.ts";
import { guarded, invalidInput, type WebFailure } from "../errors.ts";
import type { AccessContext } from "../policy/access.ts";
import type { FetchCandidate } from "../ports/providers.ts";
import type { WebSettings } from "../settings.ts";
import { MAX_DECODED_BYTES, fetchLocal, type LocalFetchOutcome } from "./local-provider.ts";
import { promote } from "./promote.ts";
import { readByRawRef } from "./raw-read.ts";
import { buildSource, contentHashOf } from "./source.ts";
import { markdownToPlainText, sliceText } from "./truncate.ts";

// L2.web.spec §4.9. 처리 순서: 정책 → 캐시 → 요청·협상 → 추출 → 승격 → 저장 → 절단. 정책 검사는 캐시 조회보다 앞이다.
// 브라우저 승격 경로는 web.browse(B10)가 들어올 때 연결한다. 지금은 render가 always여도 플러그인 후보만 쓴다.

const LOCAL_ID = "local";
const THIN_CONTENT_CHARS = 200;
const ERROR_STATUS: Readonly<Record<string, number>> = {
  denied: 403,
  not_found: 404,
  invalid_input: 400,
  timeout: 504,
  upstream_error: 502,
  too_large: 413,
  redirect_limit: 508,
  robots_disallowed: 403,
};

type CacheState = WebCallMeta["cache"];

interface Env {
  readonly input: WebFetchInput;
  readonly ctx: AccessContext;
  readonly settings: WebSettings;
  readonly table: SourceIdTable;
  readonly format: FetchFormat;
  readonly render: RenderMode;
  readonly freshness: Freshness;
  readonly maxChars: number;
  readonly timeoutMs: number;
  readonly batch: boolean;
  readonly automated: boolean;
}

interface PageResult {
  readonly page: WebFetchPage;
  readonly cache: CacheState;
  readonly cost: Cost;
  readonly pricingProvider: string;
  readonly pricing: ProviderPricing;
  readonly provider: string;
  readonly fallbacks: readonly WebProviderFallback[];
  readonly warnings: readonly string[];
  readonly noteUrls: readonly string[];
}

/** 호출 옵션에 더 얹는 내부 옵션. 조사(research)처럼 자동 수집 경로가 켠다 */
export interface FetchInternalOptions extends CallOptions {
  readonly automated?: boolean;
}

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal;
}

function contextOf(options: FetchInternalOptions | undefined): AccessContext {
  const context = options?.context;
  return {
    threadId: context?.threadId,
    caller: context?.caller ?? { kind: "host" },
    capability: "web.fetch",
    askKey: options?.requestId ?? context?.toolCallId ?? "fetch",
    signal: options?.signal ?? neverAbortedSignal(),
  };
}

function errorPage(source: WebFetchPage["source"], failure: WebFailure): WebFetchPage {
  return {
    source,
    status: ERROR_STATUS[failure.code] ?? 502,
    contentType: "",
    bytes: 0,
    content: "",
    truncated: { shown: 0, total: 0 },
    method: "plain",
    error: { code: failure.code.slice(0, 48), message: failure.message.slice(0, 512) },
  };
}

function robotsApplies(env: Env): boolean {
  const mode = env.settings.policy.robots;
  if (mode === "never") return false;
  if (mode === "always") return true;
  // auto: 자동 수집 경로(조사의 하위 fetch)와, 사용자가 직접 적지 않은 일괄 fetch
  return env.automated || (env.batch && env.ctx.caller.kind !== "host");
}

function formatText(
  format: FetchFormat,
  outcome: Extract<LocalFetchOutcome, { kind: "page" }>,
): string {
  if (outcome.literal !== undefined) return outcome.literal;
  if (outcome.converted?.kind !== "converted") return "";
  return format === "text"
    ? markdownToPlainText(outcome.converted.markdown)
    : outcome.converted.markdown;
}

function nonSpaceLength(text: string): number {
  return text.replace(/\s/g, "").length;
}

function sumCost(costs: readonly Cost[]): Cost {
  if (costs.length === 0) return NO_COST;
  const units = new Map<string, number>();
  let usd = 0;
  for (const cost of costs) {
    usd += cost.usd;
    for (const unit of cost.units) units.set(unit.name, (units.get(unit.name) ?? 0) + unit.count);
  }
  const paid = costs.filter((cost) => cost.basis !== "free");
  const asOfs = paid.flatMap((cost) => (cost.pricingAsOf === undefined ? [] : [cost.pricingAsOf]));
  const oldest = asOfs.toSorted()[0];
  const basis: Cost["basis"] =
    paid.length === 0
      ? "free"
      : paid.some((cost) => cost.basis === "estimated")
        ? "estimated"
        : "reported";
  return {
    usd,
    basis,
    units: [...units].map(([name, count]) => ({ name, count })).slice(0, 16),
    ...(basis === "estimated" && oldest !== undefined ? { pricingAsOf: oldest } : {}),
  };
}

function metaCache(results: readonly PageResult[], freshness: Freshness): CacheState {
  if (freshness === "live") return "bypass";
  if (results.length > 0 && results.every((result) => result.cache === "hit")) return "hit";
  if (results.some((result) => result.cache === "stale-revalidated")) return "stale-revalidated";
  return "miss";
}

export function createFetchApi(deps: WebDeps): {
  readonly fetch: (input: WebFetchInput, options?: FetchInternalOptions) => Promise<WebFetchOutput>;
} {
  /** 저장·절단·Source를 거쳐 페이지 하나를 만든다 */
  function finish(
    env: Env,
    args: {
      readonly url: string;
      readonly providerId: string;
      readonly cachePolicy: CacheUsage;
      readonly pricing: ProviderPricing;
      readonly finalUrl: string | undefined;
      readonly status: number;
      readonly contentType: string;
      readonly method: string;
      readonly title: string | undefined;
      readonly publishedAt: string | undefined;
      readonly rawBytes: Uint8Array;
      readonly text: string;
      readonly links: readonly { readonly href: string; readonly text: string }[];
      readonly reported: Cost | undefined;
      readonly cache: CacheState;
      readonly fallbacks: readonly WebProviderFallback[];
      readonly warnings: readonly string[];
    },
  ): Result<PageResult, WebFailure> {
    const warnings = [...args.warnings];
    const now = deps.clock.now();
    // 오류 응답(4xx, 5xx)은 디스크 캐시에 두지 않는다. rawRef 이어 읽기용으로 세션 보관만 한다
    const policy: CacheUsage =
      args.status >= 400 && args.cachePolicy === "persist" ? "session" : args.cachePolicy;
    const normalized = normalizeUrl(args.url);
    const urlNorm = normalized.ok ? normalized.value : args.url;
    let rawRef: string | undefined;
    if (policy !== "none" && deps.cache !== undefined) {
      const ttlMs = env.settings.cache.fetchTtlMinutes * 60_000;
      const saved = deps.cache.save({
        cacheKey: cacheKeyOf({
          urlNorm,
          format: env.format,
          render: env.render,
          provider: args.providerId,
        }),
        url: args.url,
        urlNorm,
        finalUrl: args.finalUrl,
        provider: args.providerId,
        status: args.status,
        contentType: args.contentType,
        method: args.method,
        title: args.title,
        publishedAt: args.publishedAt,
        retention: policy === "persist" ? "persist" : "session",
        sessionId: env.ctx.threadId,
        rawBytes: args.rawBytes,
        text: args.text,
        ttlMs,
        writeCacheRow: policy === "persist" && env.freshness !== "live" && ttlMs > 0,
      });
      if (saved.ok) {
        rawRef = saved.value.rawRef;
        if (policy === "persist") {
          const swept = deps.cache.sweep(env.settings.cache.maxMegabytes * 1024 * 1024);
          if (!swept.ok) deps.logger.warn("web.cache_sweep_failed", { kind: swept.error.kind });
        }
      } else {
        deps.logger.warn("web.cache_write_failed", { kind: saved.error.kind });
        warnings.push("cache_write_failed");
      }
    } else if (policy !== "none") {
      warnings.push("cache_unavailable");
    }
    return assemble(env, { ...args, cachePolicy: policy }, rawRef, warnings, now);
  }

  function assemble(
    env: Env,
    args: Parameters<typeof finish>[1],
    rawRef: string | undefined,
    warnings: string[],
    now: number,
  ): Result<PageResult, WebFailure> {
    const sliced = sliceText(args.text, env.input.range, env.maxChars);
    if (!sliced.ok) return sliced;
    const id = env.table.idFor(args.url);
    if (!id.ok)
      return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
    if (args.finalUrl !== undefined) env.table.seed([{ id: id.value, url: args.finalUrl }]);
    const source = buildSource({
      id: id.value,
      url: args.url,
      finalUrl: args.finalUrl,
      title: args.title,
      publishedAt: args.publishedAt,
      provider: args.providerId,
      cache: args.cachePolicy,
      rawSha256: contentHashOf(args.rawBytes),
      rawRef,
      retrievedAtMs: now,
    });
    const slice = sliced.value;
    const page: WebFetchPage = {
      source,
      status: args.status,
      contentType: args.contentType.slice(0, 128),
      bytes: args.rawBytes.byteLength,
      content: slice.content,
      truncated: {
        shown: slice.shown,
        total: slice.total,
        ...(slice.nextOffset === undefined ? {} : { nextOffset: slice.nextOffset }),
      },
      method: args.method,
      ...(args.links.length === 0
        ? {}
        : { links: args.links.map((link) => ({ href: link.href, text: link.text })) }),
    };
    const priced = computeCost(
      {
        provider: args.providerId,
        pricing: args.pricing,
        ...(args.reported === undefined ? {} : { reported: args.reported }),
        units: args.pricing === "free" ? [] : [{ name: "page_content", count: 1 }],
        contextChars: slice.content.length,
      },
      now,
    );
    return ok({
      page,
      cache: args.cache,
      cost: priced.cost,
      pricingProvider: args.providerId,
      pricing: args.pricing,
      provider: args.providerId,
      fallbacks: args.fallbacks,
      warnings: [...warnings, ...priced.warnings],
      noteUrls: [
        args.url,
        ...(args.finalUrl === undefined ? [] : [args.finalUrl]),
        ...args.links.map((link) => link.href),
      ],
    });
  }

  function fromCache(
    env: Env,
    hit: CachedPage,
    url: string,
    state: CacheState,
  ): Result<PageResult, WebFailure> {
    const sliced = sliceText(hit.text, env.input.range, env.maxChars);
    if (!sliced.ok) return sliced;
    const id = env.table.idFor(url);
    if (!id.ok)
      return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
    if (hit.finalUrl !== undefined) env.table.seed([{ id: id.value, url: hit.finalUrl }]);
    const source = buildSource({
      id: id.value,
      url,
      finalUrl: hit.finalUrl,
      title: hit.title,
      publishedAt: hit.publishedAt,
      provider: hit.provider,
      cache: "persist",
      rawSha256: hit.rawSha256,
      rawRef: hit.rawRef,
      retrievedAtMs: hit.retrievedAt,
    });
    const slice = sliced.value;
    const priced = computeCost(
      { provider: hit.provider, pricing: "free", units: [], contextChars: slice.content.length },
      deps.clock.now(),
    );
    return ok({
      page: {
        source,
        status: hit.status,
        contentType: hit.contentType.slice(0, 128),
        bytes: hit.rawBytes,
        content: slice.content,
        truncated: {
          shown: slice.shown,
          total: slice.total,
          ...(slice.nextOffset === undefined ? {} : { nextOffset: slice.nextOffset }),
        },
        method: hit.method,
      },
      cache: state,
      cost: priced.cost,
      pricingProvider: hit.provider,
      pricing: "free",
      provider: hit.provider,
      fallbacks: [],
      warnings: [],
      noteUrls: [url, ...(hit.finalUrl === undefined ? [] : [hit.finalUrl])],
    });
  }

  /** 캐시 조회: 로컬 키와 플러그인 후보 키를 차례로 본다. prefer-fresh는 만료 절반이 지난 항목을 다시 가져온다 */
  function lookupCache(
    env: Env,
    urlNorm: string,
  ): { hit: CachedPage; state: CacheState } | "stale" | undefined {
    if (deps.cache === undefined || env.freshness === "live") return undefined;
    const providers = [
      LOCAL_ID,
      ...deps.catalog.fetchCandidates().map((candidate) => candidate.provider.id),
    ];
    for (const provider of providers) {
      const found = deps.cache.lookup(
        cacheKeyOf({ urlNorm, format: env.format, render: env.render, provider }),
      );
      if (!found.ok) {
        deps.logger.warn("web.cache_read_failed", { kind: found.error.kind });
        return undefined;
      }
      const hit = found.value;
      if (hit === undefined) continue;
      if (env.freshness === "prefer-fresh") {
        const age = deps.clock.now() - hit.retrievedAt;
        if (age > (hit.expiresAt - hit.retrievedAt) / 2) return "stale";
      }
      return { hit, state: "hit" };
    }
    return undefined;
  }

  async function viaPlugin(
    env: Env,
    url: string,
    candidate: FetchCandidate,
    fallbacks: readonly WebProviderFallback[],
    cache: CacheState,
  ): Promise<Result<PageResult, WebFailure>> {
    const available = await deps.probes.probe(candidate.provider, env.ctx.signal);
    if (!available.ok) {
      return err({
        code: "unavailable",
        message: `${candidate.provider.id} is unavailable: ${available.reason}`,
        retryable: true,
        provider: candidate.provider.id,
        detail: { reason: available.reason },
      });
    }
    const outcome = await promote(deps, {
      url,
      format: env.format,
      render: env.render,
      maxBytes: MAX_DECODED_BYTES,
      pluginOrder: [candidate.provider.id],
      signal: env.ctx.signal,
    });
    const success = outcome.success;
    if (success === undefined) {
      return err({
        code: "unavailable",
        message: `${candidate.provider.id} could not fetch the page.`,
        retryable: true,
        provider: candidate.provider.id,
        detail: { fallbacks: outcome.fallbacks.map((item) => `${item.provider}:${item.reason}`) },
      });
    }
    return finishFromProvider(
      env,
      url,
      success.candidate,
      success.result,
      [...fallbacks, ...outcome.fallbacks],
      cache,
    );
  }

  function finishFromProvider(
    env: Env,
    url: string,
    candidate: FetchCandidate,
    result: ProviderFetchResult,
    fallbacks: readonly WebProviderFallback[],
    cache: CacheState,
  ): Result<PageResult, WebFailure> {
    const text = env.format === "text" ? markdownToPlainText(result.markdown) : result.markdown;
    return finish(env, {
      url,
      providerId: candidate.provider.id,
      cachePolicy: candidate.cachePolicy,
      pricing: candidate.provider.manifest.pricing,
      finalUrl: result.finalUrl,
      status: result.status,
      contentType: result.contentType,
      method: `provider:${candidate.provider.id}`,
      title: result.title,
      publishedAt: result.publishedAt,
      rawBytes: new TextEncoder().encode(result.markdown),
      text,
      links: [],
      reported: result.cost,
      cache,
      fallbacks,
      warnings: result.warnings,
    });
  }

  async function fetchOne(env: Env, url: string): Promise<Result<PageResult, WebFailure>> {
    const authorized = await deps.access.authorize(url, env.ctx);
    if (!authorized.ok) return authorized;
    const target = authorized.value;
    if (robotsApplies(env)) {
      const allowed = await deps.robots.allows(target.checked.url, env.ctx.signal);
      if (!allowed) {
        return err({
          code: "robots_disallowed",
          message: `robots.txt disallows fetching ${target.checked.url.pathname} on ${target.checked.host}.`,
          retryable: false,
          detail: { host: target.checked.host },
        });
      }
    }
    const explicit = env.input.provider;
    if (explicit !== undefined && explicit !== LOCAL_ID) {
      const candidate = deps.catalog
        .fetchCandidates()
        .find((item) => item.provider.id === explicit);
      if (candidate === undefined) {
        return err({
          code: "unavailable",
          message: `Unknown fetch provider ${explicit}.`,
          retryable: false,
          detail: { reason: "unknown_provider" },
        });
      }
      return viaPlugin(env, url, candidate, [], "miss");
    }

    const normalized = normalizeUrl(url);
    const urlNorm = normalized.ok ? normalized.value : url;
    const cached = lookupCache(env, urlNorm);
    if (cached !== undefined && cached !== "stale")
      return fromCache(env, cached.hit, url, cached.state);
    const cacheState: CacheState =
      env.freshness === "live" ? "bypass" : cached === "stale" ? "stale-revalidated" : "miss";

    const local = await fetchLocal(deps, target, env.ctx, {
      format: env.format,
      extractor: env.settings.fetch.extractor,
      timeoutMs: env.timeoutMs,
    });
    if (!local.ok) return local;
    const outcome = local.value;
    if (outcome.kind === "redirect") {
      // 다른 호스트로 가는 리다이렉트는 따라가지 않는다. 호출자가 새 URL로 다시 요청하면 처음부터 정책 검사를 받는다
      const id = env.table.idFor(url);
      if (!id.ok)
        return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
      const source = buildSource({
        id: id.value,
        url,
        finalUrl: undefined,
        title: undefined,
        publishedAt: undefined,
        provider: LOCAL_ID,
        cache: "none",
        rawSha256: undefined,
        rawRef: undefined,
        retrievedAtMs: deps.clock.now(),
      });
      const priced = computeCost(
        { provider: LOCAL_ID, pricing: "free", units: [], contextChars: 0 },
        deps.clock.now(),
      );
      return ok({
        page: {
          source,
          status: outcome.status,
          contentType: "",
          bytes: 0,
          content: "",
          truncated: { shown: 0, total: 0 },
          method: "plain",
          redirect: { from: outcome.from, to: outcome.to, followed: false },
        },
        cache: cacheState,
        cost: priced.cost,
        pricingProvider: LOCAL_ID,
        pricing: "free",
        provider: LOCAL_ID,
        fallbacks: [],
        warnings: [],
        noteUrls: [url, outcome.to],
      });
    }

    const text = formatText(env.format, outcome);
    const converted = outcome.converted;
    const challenge = outcome.status === 403 && outcome.headers["cf-mitigated"] === "challenge";
    const unsupported = converted?.kind === "unsupported";
    const thin =
      converted?.kind === "converted" &&
      (converted.method === "readability" || converted.method === "defuddle") &&
      nonSpaceLength(text) < THIN_CONTENT_CHARS;
    const wantsPromotion =
      env.settings.fetch.promote === "auto" &&
      env.render !== "never" &&
      (challenge || unsupported || thin || env.render === "always");
    const fallbacks: WebProviderFallback[] = [];
    const warnings: string[] = [];
    if (wantsPromotion) {
      const promoted = await promote(deps, {
        url,
        format: env.format,
        render: env.render,
        maxBytes: MAX_DECODED_BYTES,
        pluginOrder: env.settings.fetch.pluginOrder,
        signal: env.ctx.signal,
      });
      fallbacks.push(...promoted.fallbacks);
      if (promoted.success !== undefined) {
        return finishFromProvider(
          env,
          url,
          promoted.success.candidate,
          promoted.success.result,
          fallbacks,
          cacheState,
        );
      }
      if (env.render === "always") warnings.push("browser_unavailable");
    }
    if (challenge) warnings.push("bot_challenge");
    if (unsupported) warnings.push(`unsupported_content_type:${converted.mediaType}`.slice(0, 120));
    if (nonSpaceLength(text) === 0) warnings.push("empty_content");

    const links = converted?.kind === "converted" ? converted.links : [];
    return finish(env, {
      url,
      providerId: LOCAL_ID,
      cachePolicy: "persist",
      pricing: "free",
      finalUrl: outcome.finalUrl,
      status: outcome.status,
      contentType: outcome.contentType,
      method: converted?.kind === "converted" ? converted.method : "plain",
      title: converted?.kind === "converted" ? converted.title : undefined,
      publishedAt: converted?.kind === "converted" ? converted.publishedAt : undefined,
      rawBytes: outcome.rawBytes,
      text,
      links,
      reported: undefined,
      cache: cacheState,
      fallbacks,
      warnings,
    });
  }

  async function run(
    input: WebFetchInput,
    options: FetchInternalOptions | undefined,
  ): Promise<Result<WebFetchOutput, WebFailure>> {
    const startedAt = deps.clock.now();
    const ctx = contextOf(options);
    const settings = deps.settings(ctx.threadId);
    const modes = [
      input.url !== undefined,
      input.urls !== undefined,
      input.rawRef !== undefined,
    ].filter(Boolean).length;
    if (modes !== 1) {
      return err(invalidInput("Pass exactly one of url, urls, rawRef.", { given: modes }));
    }
    const urls = input.url !== undefined ? [input.url] : (input.urls ?? []);
    const count = input.rawRef !== undefined ? 1 : urls.length;
    const limited = deps.limits.take("fetch", ctx.threadId, count, settings.limits.fetchPerSession);
    if (limited !== undefined) return err(limited);
    const tableResult = await deps.sourceIds.forThread(ctx.threadId);
    if (!tableResult.ok) {
      return err({
        code: "unavailable",
        message: "The session history could not be read.",
        retryable: true,
        detail: { reason: tableResult.error.kind },
      });
    }
    const maxChars = input.maxChars ?? settings.fetch.maxChars;
    if (input.rawRef !== undefined) {
      return readByRawRef(deps, input.rawRef, input, {
        threadId: ctx.threadId,
        table: tableResult.value,
        maxChars,
        startedAt,
      });
    }
    const env: Env = {
      input,
      ctx,
      settings,
      table: tableResult.value,
      format: input.format ?? "markdown",
      render: input.render ?? "auto",
      freshness: input.freshness ?? "cached-ok",
      maxChars,
      timeoutMs: input.timeoutMs ?? settings.fetch.timeoutSeconds * 1000,
      batch: input.urls !== undefined,
      automated: options?.automated === true,
    };
    const outcomes = await Promise.all(urls.map((url) => fetchOne(env, url)));
    const results: PageResult[] = [];
    const pages: WebFetchPage[] = [];
    const failedWarnings: string[] = [];
    for (const [index, outcome] of outcomes.entries()) {
      const url = urls[index] ?? "";
      if (outcome.ok) {
        results.push(outcome.value);
        pages.push(outcome.value.page);
        continue;
      }
      // 한 건짜리 호출의 실패는 호출 실패다. 일괄 호출은 그 URL의 페이지에만 error를 싣는다
      if (!env.batch) return outcome;
      const id = env.table.idFor(url);
      if (!id.ok)
        return err({ code: "internal", message: "Source ids are exhausted.", retryable: false });
      const source = buildSource({
        id: id.value,
        url,
        finalUrl: undefined,
        title: undefined,
        publishedAt: undefined,
        provider: LOCAL_ID,
        cache: "none",
        rawSha256: undefined,
        rawRef: undefined,
        retrievedAtMs: deps.clock.now(),
      });
      pages.push(errorPage(source, outcome.error));
      failedWarnings.push(`page_failed:${outcome.error.code}`);
    }
    // 사용량 기록은 provider별로 한 번에 모은다
    const warnings = [...failedWarnings, ...results.flatMap((result) => result.warnings)];
    if (deps.meter !== undefined) {
      for (const result of results) {
        if (result.cache === "hit") continue;
        const recorded = deps.meter.record(result.pricingProvider, result.cost, result.pricing);
        if (recorded.ok) warnings.push(...recorded.value);
        else deps.logger.warn("web.usage_record_failed", { kind: recorded.error.kind });
      }
    }
    // 나온 URL 집합: 돌려준 URL, 리다이렉트 to, links
    if (ctx.threadId !== undefined) {
      deps.seen.note(
        ctx.threadId,
        results.flatMap((result) => result.noteUrls),
      );
    }
    const first = results[0];
    const provider = input.provider ?? first?.provider ?? LOCAL_ID;
    return ok({
      pages,
      meta: buildMeta({
        ids: deps.ids,
        clock: deps.clock,
        startedAt,
        provider,
        selectedBy: input.provider === undefined ? "auto" : "call",
        fallbacks: results.flatMap((result) => result.fallbacks),
        cache: metaCache(results, env.freshness),
        cost: sumCost(results.map((result) => result.cost)),
        warnings,
      }),
    });
  }

  return {
    fetch: (input, options) => guarded(WebFetch.id, "fetch", () => run(input, options)),
  };
}
