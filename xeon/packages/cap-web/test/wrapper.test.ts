import { afterEach, describe, expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import type { ProviderSearchRequest } from "@xeon/contracts/capabilities";
import { BUILTIN_WRAPPER_PRICING } from "../src/cost/pricing.ts";
import type { WebFailure } from "../src/errors.ts";
import { WebHttpError } from "../src/policy/guarded-http.ts";
import { normalizeHostedSearch, publishedDateOfPageAge } from "../src/search/model-tool.ts";
import {
  createWrapperProvider,
  WRAPPER_SYSTEM_PROMPT,
} from "../src/search/providers/builtin-wrapper.ts";
import { parseSearchQuery } from "../src/search/query.ts";
import type { FakeHostedSearch } from "../src/testing/fake-hosted-search.ts";
import { manualClock } from "./support/clock.ts";
import { releaseStores } from "./support/store.ts";
import { hostedTape } from "./support/tapes.ts";
import { makeWebWorld } from "./support/web-world.ts";

afterEach(releaseStores);

const SIGNAL = new AbortController().signal;

function request(query = "xeon runtime", overrides: Partial<ProviderSearchRequest> = {}) {
  const parsed = parseSearchQuery(query);
  const value: ProviderSearchRequest = {
    terms: parsed.terms,
    directives: parsed.directives,
    limit: 10,
    domains: { allow: [], deny: [] },
    content: "snippets",
    freshness: "cached-ok",
    ...overrides,
  };
  return value;
}

function wrapperOver(hosted: FakeHostedSearch, maxContinuations = 3) {
  const settings = { model: "auto", maxContinuations };
  return {
    settings,
    provider: createWrapperProvider({
      hosted,
      clock: manualClock(),
      logger: noopLogger,
      settings: () => settings,
    }),
  };
}

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => noopLogger,
};

/** provider 코드가 던진 실패. 앞단(`failureOfThrown`)이 능력 오류로 바꾼다 */
async function rejection(promise: Promise<unknown>): Promise<WebFailure> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof WebHttpError)) throw new Error("expected a WebHttpError");
  return caught.failure;
}

describe("builtin wrapper", () => {
  test("a hosted search becomes items with cited snippets and a single call", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { provider } = wrapperOver(hosted);
    const result = await provider.search(request("release notes site:docs.example.org"), SIGNAL);
    expect(hosted.requests).toHaveLength(1);
    const [sent] = hosted.requests;
    expect(sent).toMatchObject({
      model: "auto",
      system: WRAPPER_SYSTEM_PROMPT,
      query: "release notes site:docs.example.org",
      maxOutputTokens: 512,
      continuation: null,
    });
    expect(result.items.map((item) => item.url)).toEqual([
      "https://docs.example.org/guide",
      "https://news.example.org/story?utm_source=feed",
      "https://blog.example.org/post",
      "https://elsewhere.example.org/quote",
    ]);
    expect(result.items[0]).toEqual({
      url: "https://docs.example.org/guide",
      title: "Guide",
      publishedAt: "2025-04-30",
      passages: [{ text: "The guide explains the setup in three steps.", kind: "snippet" }],
    });
    // 상대 표현(2 days ago)은 날짜로 읽지 않는다
    expect(result.items[1]?.publishedAt).toBeUndefined();
    expect(result.items[3]).toMatchObject({ title: "Quote", passages: [{ kind: "snippet" }] });
    expect(result.appliedNatively).toEqual(["domains"]);
  });

  test("pause_turn continuation limit", async () => {
    const hosted = hostedTape("wrapper-pause-limit");
    const { provider } = wrapperOver(hosted, 3);
    const result = await provider.search(request(), SIGNAL);
    // 첫 요청 하나와 이어 요청 셋. 네 번째 pause_turn에서 멈추고 그때까지 받은 결과를 돌려준다
    expect(hosted.requests.map((sent) => sent.continuation)).toEqual([null, "c1", "c2", "c3"]);
    expect(result.items).toHaveLength(4);
    expect(result.warnings).toEqual(["wrapper_continuation_limit"]);
  });

  test("a zero continuation limit never re-requests", async () => {
    const hosted = hostedTape("wrapper-pause-limit");
    const { provider } = wrapperOver(hosted, 0);
    const result = await provider.search(request(), SIGNAL);
    expect(hosted.requests).toHaveLength(1);
    expect(result.warnings).toEqual(["wrapper_continuation_limit"]);
  });

  test("wrapper drops encrypted content", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { provider } = wrapperOver(hosted);
    const result = await provider.search(request(), SIGNAL);
    const text = JSON.stringify(result);
    expect(text).not.toContain("encrypted_content");
    expect(text).not.toContain("encrypted_index");
    expect(Object.keys(result.items[0] ?? {}).toSorted()).toEqual([
      "passages",
      "publishedAt",
      "title",
      "url",
    ]);
  });

  test("wrapper cost estimate", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { provider } = wrapperOver(hosted);
    const result = await provider.search(request(), SIGNAL);
    expect(result.cost?.basis).toBe("estimated");
    expect(result.cost?.pricingAsOf).toBe(BUILTIN_WRAPPER_PRICING.asOf);
    expect(result.cost?.units).toEqual([
      { name: "search", count: 1 },
      { name: "tokens_in", count: 1200 },
      { name: "tokens_out", count: 90 },
    ]);
    expect(result.cost?.usd).toBeCloseTo(0.01 + 1200 * 0.0000001 + 90 * 0.0000005, 10);
  });

  test("the service prices a wrapper call from its units and keeps basis estimated", async () => {
    const hosted = hostedTape("wrapper-basic");
    const world = await makeWebWorld({ builtinSearch: true, hostedSearch: hosted });
    // SearXNG는 이 시험에서 없다. 래퍼만 고른다
    const found = await world.search({ query: "xeon", provider: "builtin-wrapper" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.cost.basis).toBe("estimated");
    expect(found.meta.cost.pricingAsOf).toBe("2026-10-21");
    expect(found.meta.cost.units).toContainEqual({ name: "tokens_in", count: 1200 });
    expect(found.meta.cost.usd).toBeGreaterThan(0.01);
    // Source는 session 정책으로만 남는다(약관 미확인)
    expect(found.sources.every((source) => source.usage.cache === "session")).toBe(true);
  });

  test("an organization block is remembered and cleared when the model setting changes", async () => {
    const hosted = hostedTape("wrapper-org-disabled");
    const { provider, settings } = wrapperOver(hosted);
    expect(await provider.isAvailable(SIGNAL)).toEqual({ ok: true });
    const failed = await rejection(provider.search(request(), SIGNAL));
    expect(failed.code).toBe("unavailable");
    expect(failed.detail).toEqual({ reason: "org-disabled" });
    // 이후 탐침은 모델 호출 없이 거절한다
    expect(await provider.isAvailable(SIGNAL)).toEqual({ ok: false, reason: "org-disabled" });
    expect(hosted.requests).toHaveLength(1);
    settings.model = "anthropic/other-model";
    expect(await provider.isAvailable(SIGNAL)).toEqual({ ok: true });
  });

  test("a model without hosted search is unsupported", async () => {
    const hosted = hostedTape("wrapper-basic");
    hosted.setSupport({ supported: false, reason: "no_hosted_search" });
    const { provider } = wrapperOver(hosted);
    expect(await provider.isAvailable(SIGNAL)).toEqual({
      ok: false,
      reason: "unsupported-model",
      detail: "no_hosted_search",
    });
    expect(hosted.supportQueries).toEqual(["auto"]);
    expect(hosted.requests).toHaveLength(0);
  });

  test("port errors become capability errors that the chain can route", async () => {
    const cases: readonly {
      error: Parameters<typeof tapeErrorPort>[0];
      code: string;
      retryAfterMs?: number;
    }[] = [
      {
        error: { kind: "rate_limited", retryAfterMs: 4000 },
        code: "rate_limited",
        retryAfterMs: 4000,
      },
      { error: { kind: "upstream", status: 500, message: "boom" }, code: "upstream_error" },
      { error: { kind: "cancelled" }, code: "aborted" },
      {
        error: { kind: "unsupported_model", provider: null, modelId: null },
        code: "unavailable",
      },
    ];
    const failures = await Promise.all(
      cases.map((item) => {
        const { provider } = wrapperOver(tapeErrorPort(item.error));
        return rejection(provider.search(request(), SIGNAL));
      }),
    );
    for (const [index, item] of cases.entries()) {
      expect(failures[index]?.code).toBe(item.code);
      if (item.retryAfterMs !== undefined) {
        expect(failures[index]?.retryAfterMs).toBe(item.retryAfterMs);
      }
    }
  });

  test("domain filters go to the hosted tool and the query keeps the directives", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { provider } = wrapperOver(hosted);
    await provider.search(
      request('"exact phrase" -spam filetype:pdf after:2026-01-01 intitle:report foo', {
        domains: { allow: ["docs.example.org"], deny: [] },
      }),
      SIGNAL,
    );
    expect(hosted.requests[0]?.domains).toEqual({ allow: ["docs.example.org"], deny: [] });
    expect(hosted.requests[0]?.query).toBe(
      'foo "exact phrase" -spam filetype:pdf intitle:"report" after:2026-01-01',
    );
  });
});

describe("normalizeHostedSearch", () => {
  test("page_age forms", () => {
    expect(publishedDateOfPageAge("April 30, 2025")).toBe("2025-04-30");
    expect(publishedDateOfPageAge("Sept. 3 2025")).toBe("2025-09-03");
    expect(publishedDateOfPageAge("Sep. 13, 2025")).toBe("2025-09-13");
    expect(publishedDateOfPageAge("Foo 3, 2025")).toBeUndefined();
    expect(publishedDateOfPageAge("2025-04-30")).toBe("2025-04-30");
    expect(publishedDateOfPageAge("2025-04-30T10:00:00Z")).toBe("2025-04-30");
    expect(publishedDateOfPageAge("yesterday")).toBeUndefined();
    expect(publishedDateOfPageAge(null)).toBeUndefined();
  });

  test("duplicate urls merge across continuation responses and keep first-seen order", () => {
    const base = {
      stopReason: "end_turn" as const,
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, searchRequests: 0 },
      model: { provider: "anthropic", modelId: "m" },
      continuation: null,
      citations: [],
    };
    const items = normalizeHostedSearch([
      {
        ...base,
        results: [
          { url: "https://a.example/x?utm_source=1", title: null, pageAge: null },
          { url: "https://b.example/y", title: "B", pageAge: null },
        ],
      },
      {
        ...base,
        results: [{ url: "https://a.example/x", title: "A", pageAge: "May 2, 2025" }],
        citations: [
          { url: "https://a.example/x", title: null, citedText: "same   words" },
          { url: "https://a.example/x", title: null, citedText: "same words" },
        ],
      },
    ]);
    expect(items).toEqual([
      {
        url: "https://a.example/x?utm_source=1",
        title: "A",
        publishedAt: "2025-05-02",
        passages: [{ text: "same words", kind: "snippet" }],
      },
      { url: "https://b.example/y", title: "B", passages: [] },
    ]);
  });
});

function tapeErrorPort(
  error:
    | {
        readonly kind: "rate_limited";
        readonly retryAfterMs: number | null;
      }
    | {
        readonly kind: "upstream";
        readonly status: number | null;
        readonly message: string;
      }
    | { readonly kind: "cancelled" }
    | {
        readonly kind: "unsupported_model";
        readonly provider: string | null;
        readonly modelId: string | null;
      },
): FakeHostedSearch {
  const base = hostedTape("wrapper-basic");
  return {
    ...base,
    search: (sent) => {
      base.requests.push(sent);
      return Promise.resolve({ ok: false, error });
    },
  };
}
