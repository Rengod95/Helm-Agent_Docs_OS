import { expect, test } from "bun:test";
import type { ScopeStack } from "@xeon/contracts/settings";
import { DEFAULT_WEB_SETTINGS, describeWebSettings } from "@xeon/cap-web";
import { createWebPort, type WebStatusHolder } from "../../src/assembly/web-providers.ts";

// M3-REQ-96. `web.providers`의 값: 런타임이 있으면 provider 목록을 그대로, 설정 값은 설정 층의 유효 값이다.

const EMPTY: ScopeStack = [];
const ROW = {
  id: "builtin-wrapper",
  capability: "web.search",
  origin: "builtin",
  displayName: "Built-in search",
  auth: "none",
  status: { kind: "ok" },
  pricingAsOf: null,
  pricingStale: false,
  firstUseNoticed: true,
  autoRank: 0,
} as const;

test("without a web runtime the port answers no providers and the default settings", async () => {
  const holder: WebStatusHolder = { current: undefined };
  const port = createWebPort({ holder, settings: { layers: () => EMPTY } });

  expect(await port.providers(new AbortController().signal)).toEqual({
    providers: [],
    settings: describeWebSettings(DEFAULT_WEB_SETTINGS),
  });
});

test("with a web runtime the port passes its provider rows through and reads the effective settings from the layers", async () => {
  const seen: AbortSignal[] = [];
  const holder: WebStatusHolder = {
    current: {
      providerStatus: (signal) => {
        seen.push(signal);
        return Promise.resolve([ROW]);
      },
    },
  };
  const layers: ScopeStack = [
    { scope: "user", values: new Map<string, unknown>([["l2.web.search.provider", "exa"]]) },
  ];
  const port = createWebPort({ holder, settings: { layers: () => layers } });
  const signal = new AbortController().signal;

  const answer = await port.providers(signal);

  expect(answer.providers).toEqual([ROW]);
  expect(answer.settings.searchProvider).toBe("exa");
  expect(answer.settings.browseProvider).toBe(DEFAULT_WEB_SETTINGS.browse.provider);
  expect(seen).toEqual([signal]);
});
