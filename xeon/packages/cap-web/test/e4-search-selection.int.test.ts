import { describe, expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { WebService } from "@fresnel/contracts/capabilities";
import type { HostedSearchPort } from "@fresnel/contracts/services";
import { directConvertRunner } from "../src/fetch/convert-runner.ts";
import type { PluginRegistration } from "../src/search/registry.ts";
import { createWebRuntime } from "../src/runtime.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../src/settings.ts";
import { fakeSearchProvider, type FakeSearchProvider } from "../src/testing/fake-providers.ts";
import { fakeSessionSources } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport, type FixtureTransport } from "../src/testing/http-fixtures.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { hostedTape } from "./support/tapes.ts";

// m2-plan E4: 검색 도구의 기본 선택. 키를 등록한 플러그인이 없으면 `web.search`는 내장 검색 래퍼가 답하고 아무것도 탐침하지 않는다.
// 플러그인을 설치해 순서의 앞에 올리면 그 플러그인이 답하고 래퍼는 불리지 않는다(L2.web.spec §9 수용 기준 1, 2).
// 자동 감지는 없다(ADR-0005 개정, 사용자 결정 H1). 플러그인 provider는 키 기반 가짜이고, 모델 호출은 테이프다. 인터넷 요청은 없다.

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

const PLUGIN_ID = "plugin:example-search";

interface Built {
  readonly service: WebService;
  /** 네트워크로 나간 요청. 이 시험에서는 아무것도 나가지 않아야 한다 */
  readonly transport: FixtureTransport;
}

/** 플러그인 하나를 등록하고(없으면 등록하지 않는다) 사용자 순서를 정해 조립한다 */
function build(
  plugin: FakeSearchProvider | undefined,
  options: { readonly hosted?: HostedSearchPort; readonly order?: readonly string[] } = {},
): Built {
  const settings: WebSettings = {
    ...DEFAULT_WEB_SETTINGS,
    search: { ...DEFAULT_WEB_SETTINGS.search, order: options.order ?? [] },
  };
  const registrations: readonly PluginRegistration[] =
    plugin === undefined
      ? []
      : [
          {
            extension: "example-search",
            registration: { capability: "web.search", create: () => plugin },
          },
        ];
  const resolver = fakeResolver();
  const transport = fixtureTransport({}, resolver);
  const runtime = createWebRuntime({
    clock: manualClock(),
    ids: fixedLocalIds(),
    logger: SILENT,
    settings: () => settings,
    sessionSources: fakeSessionSources(),
    resolver,
    transport,
    convert: directConvertRunner(),
    registrations: { list: () => registrations },
    ...(options.hosted === undefined ? {} : { hostedSearch: options.hosted }),
  });
  return { service: runtime.service, transport };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe("E4 web.search provider selection", () => {
  test("a plugin listed first answers and the wrapper is never called", async () => {
    const hosted = hostedTape("wrapper-basic");
    const plugin = fakeSearchProvider(PLUGIN_ID);
    const { service } = build(plugin, { hosted, order: [PLUGIN_ID] });
    const found = await service.search.search({ query: "fresnel" });
    expect(found.meta.provider).toBe(PLUGIN_ID);
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.fallbacks).toEqual([]);
    expect(found.meta.cost.basis).toBe("estimated");
    expect(plugin.searches.map((request) => request.terms)).toEqual(["fresnel"]);
    expect(hosted.requests).toHaveLength(0);
  });

  test("without a plugin the wrapper answers alone and nothing is probed", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { service, transport } = build(undefined, { hosted });
    const found = await service.search.search({ query: "fresnel" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.fallbacks).toEqual([]);
    expect(found.meta.cost.basis).toBe("estimated");
    expect(transport.requests).toHaveLength(0);
    expect(hosted.requests).toHaveLength(1);
    expect(found.results.length).toBeGreaterThan(0);
  });

  test("a listed plugin that is not available falls back to the wrapper and the fallback names the probe", async () => {
    const hosted = hostedTape("wrapper-basic");
    const plugin = fakeSearchProvider(PLUGIN_ID, {
      availability: { ok: false, reason: "no-key" },
    });
    const { service } = build(plugin, { hosted, order: [PLUGIN_ID] });
    const found = await service.search.search({ query: "fresnel" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.fallbacks).toEqual([
      { provider: PLUGIN_ID, stage: "probe", reason: "no-key" },
    ]);
    expect(found.meta.cost.basis).toBe("estimated");
    expect(plugin.searches).toHaveLength(0);
    expect(hosted.requests).toHaveLength(1);
    expect(found.results.length).toBeGreaterThan(0);
  });

  test("an explicit builtin-wrapper never asks the plugin", async () => {
    const hosted = hostedTape("wrapper-basic");
    const plugin = fakeSearchProvider(PLUGIN_ID);
    const { service } = build(plugin, { hosted, order: [PLUGIN_ID] });
    const found = await service.search.search({ query: "fresnel", provider: "builtin-wrapper" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.selectedBy).toBe("call");
    expect(plugin.probes()).toBe(0);
    expect(plugin.searches).toHaveLength(0);
  });

  test("an explicit plugin that is not available does not fall back", async () => {
    const hosted = hostedTape("wrapper-basic");
    const plugin = fakeSearchProvider(PLUGIN_ID, {
      availability: { ok: false, reason: "no-key" },
    });
    const { service } = build(plugin, { hosted });
    const failed = await failureOf(
      service.search.search({ query: "fresnel", provider: PLUGIN_ID }),
    );
    expect(failed).toMatchObject({
      data: { code: "unavailable", detail: { reason: "no-key" } },
    });
    expect(hosted.requests).toHaveLength(0);
    expect(plugin.searches).toHaveLength(0);
  });

  test("no provider available is unavailable with the whole fallback list", async () => {
    const plugin = fakeSearchProvider(PLUGIN_ID, {
      availability: { ok: false, reason: "no-key" },
    });
    const { service } = build(plugin, { order: [PLUGIN_ID] });
    const failed = await failureOf(service.search.search({ query: "fresnel" }));
    expect(failed).toMatchObject({
      data: {
        code: "unavailable",
        detail: {
          reason: "all_failed",
          fallbacks: [{ provider: PLUGIN_ID, stage: "probe", reason: "no-key" }],
        },
      },
    });
  });

  test("asking for a plugin that is not installed is unavailable and sends nothing", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { service, transport } = build(undefined, { hosted });
    const failed = await failureOf(
      service.search.search({ query: "fresnel", provider: PLUGIN_ID }),
    );
    expect(failed).toMatchObject({
      data: { code: "unavailable", detail: { reason: "unknown_provider" } },
    });
    expect(transport.requests).toHaveLength(0);
    expect(hosted.requests).toHaveLength(0);
  });
});
