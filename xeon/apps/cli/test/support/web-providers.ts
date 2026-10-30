import type {
  WebProviderCapability,
  WebProviderState,
  WebProviderStatus,
  WebProvidersResult,
} from "@xeon/contracts/wire";

// `web.providers` 시험 도우미. 호스트가 싣는 wire 모양 그대로 만든다. 순위(autoRank)와 현재 provider는 호스트가 정한 값을 주고,
// 시험은 CLI가 그 값을 화면 줄로 옮기는지만 본다.

const OK: WebProviderState = { kind: "ok" };

const NO_KEY: WebProviderState = { kind: "unavailable", reason: "no-key" };

const DEFAULT_SETTINGS: WebProvidersResult["settings"] = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

/** provider 한 건. 값을 적지 않은 필드는 내장, 인증 없음, 쓸 수 있음, 고지 완료, 순위 없음이다 */
export function providerOf(
  id: string,
  capability: WebProviderCapability,
  fields: Partial<WebProviderStatus> = {},
): WebProviderStatus {
  return {
    id,
    capability,
    origin: "builtin",
    displayName: id,
    auth: "none",
    status: OK,
    pricingAsOf: null,
    pricingStale: false,
    firstUseNoticed: true,
    autoRank: null,
    ...fields,
  };
}

export function resultOf(
  providers: readonly WebProviderStatus[],
  settings: Partial<WebProvidersResult["settings"]> = {},
): WebProvidersResult {
  return { providers: [...providers], settings: { ...DEFAULT_SETTINGS, ...settings } };
}

/** 기본 시험 값: 내장 검색 래퍼가 순위 0으로 현재이고, Exa는 키가 없고 고지를 아직 보이지 않았다 */
export const WRAPPER: WebProviderStatus = providerOf("builtin-wrapper", "web.search", {
  displayName: "Built-in search (model provider)",
  autoRank: 0,
});

export const EXA_NO_KEY: WebProviderStatus = providerOf("plugin:web-exa", "web.search", {
  origin: "plugin",
  displayName: "Exa",
  auth: "header",
  status: NO_KEY,
  pricingAsOf: "2026-10-01",
  firstUseNoticed: false,
  autoRank: 1,
});

export const PLAYWRIGHT: WebProviderStatus = providerOf("playwright-mcp", "web.browse", {
  origin: "plugin",
  displayName: "Playwright MCP",
  autoRank: 0,
});

export const BUILTIN_FETCH: WebProviderStatus = providerOf("builtin-fetch", "web.fetch", {
  displayName: "Built-in fetch",
});

export const DEFAULT_RESULT: WebProvidersResult = resultOf([
  WRAPPER,
  EXA_NO_KEY,
  PLAYWRIGHT,
  BUILTIN_FETCH,
]);
