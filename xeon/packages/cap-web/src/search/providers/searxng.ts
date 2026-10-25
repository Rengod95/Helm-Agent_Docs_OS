import { parse, parseJson, type Logger } from "@xeon/contracts";
import type {
  ProviderAvailabilityWeb,
  ProviderSearchItem,
  ProviderSearchRequest,
  ProviderSearchResult,
  WebProviderManifest,
  WebSearchProvider,
} from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import type { WebFailure } from "../../errors.ts";
import {
  createBoundProviderHttp,
  WebHttpError,
  type BoundProviderHttp,
  type ProviderHttpDeps,
} from "../../policy/guarded-http.ts";
import { renderQueryText } from "./query-text.ts";

// L2.web.spec §4.8.3, plan B8. 사용자가 설정한 주소(`l2.web.search.searxng.url`)로 가는 SearXNG 검색 provider. 별도 프로세스의 HTTP만 쓴다
// (AGPL 코드를 번들하거나 링크하지 않는다). 주소를 찾아 나서는 자동 감지는 없다(ADR-0005 개정, 사용자 결정 H1): 주소가 비어 있으면
// 이 provider는 어디에도 요청을 보내지 않는다.
// 요청은 provider endpoint 예외(§4.6.5)로 나간다: 설정한 주소의 origin 하나만, 루프백과 사설 주소도 허용하되
// 메타데이터 주소는 거부한다. 이 예외는 이 provider의 요청에만 쓰이고 `web.fetch`의 콘텐츠 URL에는 쓰이지 않는다.

export const SEARXNG_PROVIDER_ID = "searxng";

const PROBE_TIMEOUT_MS = 1500;
/**
 * 탐침 응답 상한. spec의 64 KiB는 추측이었다. 실제 SearXNG의 `format=json` 응답은 결과 수십 건이면 그보다 크기 쉬워
 * 64 KiB에서 잘리면 감지가 항상 실패한다. 실측하지 못해 넉넉히 잡았다 [가정].
 */
const PROBE_MAX_BYTES = 512 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;
const SEARCH_MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 60;
const MAX_SNIPPET_CHARS = 2000;
const MAX_UNRESPONSIVE_WARNINGS = 4;

/** `meta.warnings`에 싣는 안내. 한 줄 코드와 해결 방법이다 */
export const SEARXNG_JSON_DISABLED_WARNING =
  "searxng_json_disabled: add json to search.formats in SearXNG settings.yml";

const SEARXNG_JSON_DISABLED_NOTICE =
  "The configured SearXNG answers 403 because its JSON format is turned off. Add json to search.formats in settings.yml.";

export function searxngManifest(): WebProviderManifest {
  return {
    name: "searxng",
    displayName: "SearXNG",
    services: ["search"],
    // 주소는 설정이나 감지로 정해진다. 요청마다 그 origin 하나가 endpoint 예외로 열린다
    endpoints: [],
    auth: { kind: "none", secrets: [] },
    pricing: {
      asOf: "2026-10-24",
      sourceUrl: "https://docs.searxng.org/",
      currency: "USD",
      units: {},
    },
    termsFlags: {
      cachePolicy: "persist",
      mayTrainOn: false,
      redistribution: "unknown",
      // 사용자가 직접 운영하는 인스턴스라 따를 외부 약관이 없다
      reviewedAt: "2026-10-24",
    },
    // 질의는 인스턴스가 고른 상위 검색 엔진으로 간다
    privacy: { zdr: "unknown", sendsTelemetry: false },
    limits: {},
  };
}

export interface SearxngDeps {
  readonly http: ProviderHttpDeps;
  /** 호출 때마다 읽는 SearXNG 설정(`l2.web.search.searxng.url`). 빈 문자열이면 설정하지 않은 것이다 */
  readonly settings: () => { readonly url: string };
  readonly logger: Logger;
}

const ProbeBodySchema = Type.Object({ query: Type.String(), results: Type.Array(Type.Unknown()) });
const SearchBodySchema = Type.Object({
  results: Type.Array(Type.Unknown()),
  unresponsive_engines: Type.Optional(Type.Array(Type.Unknown())),
});
const ResultSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  publishedDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

function bodyJson(body: Uint8Array): unknown {
  const parsed = parseJson(new TextDecoder().decode(body));
  return parsed.ok ? parsed.value : undefined;
}

/** `http://host:port/path` 형태의 기준 주소. 질의와 끝 슬래시는 뺀다. 읽지 못하거나 http(s)가 아니면 undefined */
function baseOf(raw: string): string | undefined {
  if (!URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** provider endpoint 예외로 열 `host[:port]` */
function endpointOf(base: string): string {
  return new URL(base).host;
}

const TIME_ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** SearXNG `publishedDate`를 ISO 시각으로. 시간대가 없으면 UTC로 본다 */
function publishedAtOf(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const millis = Date.parse(TIME_ZONE_SUFFIX.test(text) ? text : `${text}Z`);
  return Number.isNaN(millis) ? undefined : new Date(millis).toISOString();
}

function isHttpUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const { protocol } = new URL(raw);
  return protocol === "http:" || protocol === "https:";
}

function itemOf(raw: unknown): ProviderSearchItem | undefined {
  const parsed = parse(ResultSchema, raw);
  if (!parsed.ok || !isHttpUrl(parsed.value.url)) return undefined;
  const { url, title, content, publishedDate } = parsed.value;
  const snippet = content?.replace(/\s+/g, " ").trim() ?? "";
  const publishedAt = publishedAtOf(publishedDate);
  const heading = title?.replace(/\s+/g, " ").trim() ?? "";
  return {
    url,
    ...(heading === "" ? {} : { title: heading }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    passages:
      snippet === "" ? [] : [{ text: snippet.slice(0, MAX_SNIPPET_CHARS), kind: "snippet" }],
  };
}

/** `["brave", "timeout"]` 같은 쌍이면 첫 값, 아니면 값 그대로 */
function firstOf(entry: unknown): unknown {
  if (!Array.isArray(entry)) return entry;
  const items: readonly unknown[] = entry;
  return items[0];
}

function engineNamesOf(entries: readonly unknown[] | undefined): string[] {
  const names: string[] = [];
  for (const entry of entries ?? []) {
    const name = firstOf(entry);
    if (typeof name === "string" && name !== "") names.push(name.slice(0, 48));
  }
  return names;
}

function retryAfterMsOf(headers: Readonly<Record<string, string>>): number | undefined {
  const seconds = Number(headers["retry-after"]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : undefined;
}

function failureOfStatus(status: number, headers: Readonly<Record<string, string>>): WebFailure {
  if (status === 403) {
    return {
      code: "unavailable",
      message: SEARXNG_JSON_DISABLED_NOTICE,
      retryable: false,
      detail: { reason: "json-disabled" },
    };
  }
  if (status === 429) {
    const retryAfterMs = retryAfterMsOf(headers);
    return {
      code: "rate_limited",
      message: "SearXNG rate limited the request.",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  return {
    code: "upstream_error",
    message: `SearXNG answered HTTP ${String(status)}.`,
    retryable: status >= 500,
  };
}

type Probed =
  | { readonly ok: true; readonly base: string }
  | {
      readonly ok: false;
      readonly reason: "unreachable" | "json-disabled";
      readonly detail: string;
    };

export function createSearxngProvider(deps: SearxngDeps): WebSearchProvider {
  const manifest = searxngManifest();
  const clients = new Map<string, BoundProviderHttp>();
  let warnedJsonDisabled = false;

  function clientFor(base: string): BoundProviderHttp {
    const known = clients.get(base);
    if (known !== undefined) return known;
    const bound = createBoundProviderHttp(deps.http, { localEndpoints: [endpointOf(base)] });
    bound.bind(manifest);
    clients.set(base, bound);
    return bound;
  }

  /** 주소 하나를 탐침한다 */
  async function probeOne(base: string, signal: AbortSignal): Promise<Probed> {
    const sent = await clientFor(base).request(
      {
        method: "GET",
        url: `${base}/search?q=xeon&format=json&pageno=1`,
        headers: { accept: "application/json" },
        timeoutMs: PROBE_TIMEOUT_MS,
        maxBytes: PROBE_MAX_BYTES,
      },
      signal,
    );
    if (!sent.ok) {
      return { ok: false, reason: "unreachable", detail: `${base}: ${sent.error.code}` };
    }
    const { status, body } = sent.value;
    if (status === 403) {
      return {
        ok: false,
        reason: "json-disabled",
        detail: `${base}: format=json is turned off (HTTP 403)`,
      };
    }
    if (status !== 200) {
      return { ok: false, reason: "unreachable", detail: `${base}: HTTP ${String(status)}` };
    }
    const shaped = parse(ProbeBodySchema, bodyJson(body));
    if (!shaped.ok) {
      return { ok: false, reason: "unreachable", detail: `${base}: not a SearXNG JSON response` };
    }
    return { ok: true, base };
  }

  /** 설정한 주소를 탐침한다. 주소가 비어 있거나 http(s) 주소가 아니면 요청을 보내지 않는다 */
  async function probeConfigured(signal: AbortSignal): Promise<Probed> {
    const { url } = deps.settings();
    if (url === "") {
      return {
        ok: false,
        reason: "unreachable",
        detail: "no SearXNG address is set (l2.web.search.searxng.url)",
      };
    }
    const base = baseOf(url);
    if (base === undefined) {
      return {
        ok: false,
        reason: "unreachable",
        detail: "the configured SearXNG URL is not a valid http(s) URL",
      };
    }
    if (signal.aborted) {
      return { ok: false, reason: "unreachable", detail: "the probe was aborted" };
    }
    const probed = await probeOne(base, signal);
    if (!probed.ok && probed.reason === "json-disabled" && !warnedJsonDisabled) {
      warnedJsonDisabled = true;
      deps.logger.warn("web.searxng_json_disabled", { detail: probed.detail });
    }
    return probed;
  }

  async function isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb> {
    const found = await probeConfigured(signal);
    if (found.ok) return { ok: true };
    return { ok: false, reason: found.reason, detail: found.detail };
  }

  /** 검색에 쓸 주소. 설정한 주소뿐이다. 비어 있거나 잘못된 주소면 요청 없이 `unavailable`이다 */
  function baseForSearch(): string {
    const base = baseOf(deps.settings().url);
    if (base !== undefined) return base;
    throw new WebHttpError({
      code: "unavailable",
      message: "SearXNG is unavailable: no valid address is configured.",
      retryable: false,
      detail: { reason: "unreachable" },
    });
  }

  async function search(
    request: ProviderSearchRequest,
    signal: AbortSignal,
  ): Promise<ProviderSearchResult> {
    const base = baseForSearch();
    const query = new URLSearchParams({
      q: renderQueryText(request, { includeDates: false }),
      format: "json",
      pageno: "1",
      categories: "general",
    });
    if (request.recency !== undefined) query.set("time_range", request.recency);
    const sent = await clientFor(base).request(
      {
        method: "GET",
        url: `${base}/search?${query.toString()}`,
        headers: { accept: "application/json" },
        timeoutMs: SEARCH_TIMEOUT_MS,
        maxBytes: SEARCH_MAX_BYTES,
      },
      signal,
    );
    if (!sent.ok) throw new WebHttpError(sent.error);
    if (sent.value.status !== 200) {
      throw new WebHttpError(failureOfStatus(sent.value.status, sent.value.headers));
    }
    const shaped = parse(SearchBodySchema, bodyJson(sent.value.body));
    if (!shaped.ok) {
      throw new WebHttpError({
        code: "upstream_error",
        message: "SearXNG answered with a body that is not search JSON.",
        retryable: true,
      });
    }
    const items: ProviderSearchItem[] = [];
    for (const raw of shaped.value.results) {
      const item = itemOf(raw);
      if (item !== undefined) items.push(item);
      if (items.length >= Math.min(MAX_ITEMS, request.limit * 3)) break;
    }
    const unresponsive = engineNamesOf(shaped.value.unresponsive_engines);
    if (items.length === 0 && unresponsive.length > 0) {
      throw new WebHttpError({
        code: "upstream_error",
        message: "Every SearXNG engine failed to answer.",
        retryable: true,
        detail: { engines: unresponsive.slice(0, MAX_UNRESPONSIVE_WARNINGS) },
      });
    }
    return {
      items,
      appliedNatively: request.recency === undefined ? [] : ["recency"],
      warnings: unresponsive
        .slice(0, MAX_UNRESPONSIVE_WARNINGS)
        .map((engine) => `searxng_engine_unresponsive:${engine}`),
    };
  }

  return { id: SEARXNG_PROVIDER_ID, manifest, isAvailable, search };
}
