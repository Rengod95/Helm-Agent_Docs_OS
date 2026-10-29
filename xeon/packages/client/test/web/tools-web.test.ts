import { describe, expect, test } from "bun:test";
import type {
  WebProviderCapability,
  WebProviderStatus,
  WebProvidersResult,
} from "@xeon/contracts/wire";
import {
  moveInOrder,
  orderUpdateOf,
  toolsWebViewOf,
  type ToolsWebView,
  type WebToolRow,
} from "../../src/web/index.ts";

const DEFAULT_SETTINGS: WebProvidersResult["settings"] = {
  searchProvider: "auto",
  searchOrder: [],
  searchParallel: 1,
  browseProvider: "auto",
  browseOrder: [],
  robots: "never",
};

const OK: WebProviderStatus["status"] = { kind: "ok" };
const NO_KEY: WebProviderStatus["status"] = { kind: "unavailable", reason: "no-key" };

function provider(
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

// wire 행. 순위(autoRank)는 호스트가 정한 값으로 주고, 시험은 그 값을 그대로 읽는다
const WRAPPER_STATUS = provider("builtin-wrapper", "web.search", {
  displayName: "내장 검색 래퍼",
  autoRank: 0,
});
const EXA_STATUS = provider("plugin:web-exa", "web.search", {
  origin: "plugin",
  displayName: "Exa",
  auth: "header",
  status: NO_KEY,
  pricingAsOf: "2026-10-01",
  firstUseNoticed: false,
  autoRank: 1,
});
const PLAYWRIGHT_STATUS = provider("playwright-mcp", "web.browse", {
  displayName: "Playwright MCP",
  autoRank: 0,
});
const FETCH_STATUS = provider("builtin-fetch", "web.fetch", { displayName: "내장 가져오기" });

const DEFAULT_RESULT: WebProvidersResult = {
  providers: [WRAPPER_STATUS, EXA_STATUS, PLAYWRIGHT_STATUS, FETCH_STATUS],
  settings: DEFAULT_SETTINGS,
};

// 기대 행. 같은 행을 여러 시험이 덮어쓰므로 공통 값을 한 곳에 둔다
const WRAPPER_ROW: WebToolRow = {
  id: "builtin-wrapper",
  capability: "web.search",
  displayName: "내장 검색 래퍼",
  origin: "builtin",
  auth: "none",
  ok: true,
  reason: null,
  detail: null,
  note: "사용할 수 있다",
  rank: 0,
  current: true,
  pinned: false,
  noticePending: false,
  price: null,
};
const EXA_ROW: WebToolRow = {
  id: "plugin:web-exa",
  capability: "web.search",
  displayName: "Exa",
  origin: "plugin",
  auth: "header",
  ok: false,
  reason: "no-key",
  detail: null,
  note: "키가 없다 — 해결: xeon secret add exa-api-key",
  rank: 1,
  current: false,
  pinned: false,
  noticePending: true,
  price: { asOf: "2026-10-01", stale: false },
};
const PLAYWRIGHT_ROW: WebToolRow = {
  id: "playwright-mcp",
  capability: "web.browse",
  displayName: "Playwright MCP",
  origin: "builtin",
  auth: "none",
  ok: true,
  reason: null,
  detail: null,
  note: "사용할 수 있다",
  rank: 0,
  current: true,
  pinned: false,
  noticePending: false,
  price: null,
};
const FETCH_ROW: WebToolRow = {
  id: "builtin-fetch",
  capability: "web.fetch",
  displayName: "내장 가져오기",
  origin: "builtin",
  auth: "none",
  ok: true,
  reason: null,
  detail: null,
  note: "사용할 수 있다",
  rank: null,
  current: false,
  pinned: false,
  noticePending: false,
  price: null,
};

const DEFAULT_VIEW: ToolsWebView = {
  search: { capability: "web.search", provider: "auto", order: [], rows: [WRAPPER_ROW, EXA_ROW] },
  browse: { capability: "web.browse", provider: "auto", order: [], rows: [PLAYWRIGHT_ROW] },
  fetch: { capability: "web.fetch", provider: "auto", order: [], rows: [FETCH_ROW] },
  parallel: 1,
  robots: { value: "never", follows: false },
  recommendations: [
    {
      label: "Exa",
      providerId: "plugin:web-exa",
      secretName: "exa-api-key",
      state: "needs-key",
      hint: "xeon secret add exa-api-key",
    },
    {
      label: "Brave",
      providerId: "plugin:web-brave",
      secretName: "brave-api-key",
      state: "not-installed",
      hint: "플러그인을 설치한다",
    },
  ],
  noticesPending: ["plugin:web-exa"],
};

describe("toolsWebViewOf", () => {
  test("default: the builtin wrapper is current by rank, Exa needs a key, Brave is not installed", () => {
    expect(toolsWebViewOf(DEFAULT_RESULT)).toEqual(DEFAULT_VIEW);
  });

  test("a user order that puts an ok plugin first moves the current mark with the rank", () => {
    const result: WebProvidersResult = {
      providers: [
        { ...WRAPPER_STATUS, autoRank: 1 },
        { ...EXA_STATUS, status: OK, firstUseNoticed: true, autoRank: 0 },
        PLAYWRIGHT_STATUS,
        FETCH_STATUS,
      ],
      settings: { ...DEFAULT_SETTINGS, searchOrder: ["plugin:web-exa", "builtin-wrapper"] },
    };
    expect(toolsWebViewOf(result)).toEqual({
      ...DEFAULT_VIEW,
      search: {
        capability: "web.search",
        provider: "auto",
        order: ["plugin:web-exa", "builtin-wrapper"],
        rows: [
          {
            ...EXA_ROW,
            ok: true,
            reason: null,
            note: "사용할 수 있다",
            rank: 0,
            current: true,
            noticePending: false,
          },
          { ...WRAPPER_ROW, rank: 1, current: false },
        ],
      },
      recommendations: [
        {
          label: "Exa",
          providerId: "plugin:web-exa",
          secretName: "exa-api-key",
          state: "ready",
          hint: "",
        },
        {
          label: "Brave",
          providerId: "plugin:web-brave",
          secretName: "brave-api-key",
          state: "not-installed",
          hint: "플러그인을 설치한다",
        },
      ],
      noticesPending: [],
    });
  });

  test("a fixed provider is the only current row and pinned, even when another row ranks first", () => {
    const result: WebProvidersResult = {
      providers: [
        WRAPPER_STATUS,
        { ...EXA_STATUS, status: OK, firstUseNoticed: true },
        PLAYWRIGHT_STATUS,
        FETCH_STATUS,
      ],
      settings: { ...DEFAULT_SETTINGS, searchProvider: "plugin:web-exa" },
    };
    expect(toolsWebViewOf(result)).toEqual({
      ...DEFAULT_VIEW,
      search: {
        capability: "web.search",
        provider: "plugin:web-exa",
        order: [],
        rows: [
          { ...WRAPPER_ROW, current: false },
          {
            ...EXA_ROW,
            ok: true,
            reason: null,
            note: "사용할 수 있다",
            current: true,
            pinned: true,
            noticePending: false,
          },
        ],
      },
      recommendations: [
        {
          label: "Exa",
          providerId: "plugin:web-exa",
          secretName: "exa-api-key",
          state: "ready",
          hint: "",
        },
        {
          label: "Brave",
          providerId: "plugin:web-brave",
          secretName: "brave-api-key",
          state: "not-installed",
          hint: "플러그인을 설치한다",
        },
      ],
      noticesPending: [],
    });
  });

  test("a pinned provider that is down stays the current row and carries the probe detail", () => {
    const result: WebProvidersResult = {
      providers: [
        WRAPPER_STATUS,
        {
          ...EXA_STATUS,
          status: { kind: "unavailable", reason: "unreachable", detail: "timeout after 5s" },
          firstUseNoticed: true,
        },
      ],
      settings: { ...DEFAULT_SETTINGS, searchProvider: "plugin:web-exa" },
    };
    expect(toolsWebViewOf(result).search.rows).toEqual([
      { ...WRAPPER_ROW, current: false },
      {
        ...EXA_ROW,
        ok: false,
        reason: "unreachable",
        detail: "timeout after 5s",
        note: "응답이 없다",
        current: true,
        pinned: true,
        noticePending: false,
        price: { asOf: "2026-10-01", stale: false },
      },
    ]);
  });

  test("stale pricing is carried as the price's stale flag, and a free provider has no price", () => {
    const result: WebProvidersResult = {
      providers: [
        WRAPPER_STATUS,
        { ...EXA_STATUS, pricingAsOf: "2026-01-05", pricingStale: true },
        PLAYWRIGHT_STATUS,
        FETCH_STATUS,
      ],
      settings: DEFAULT_SETTINGS,
    };
    expect(toolsWebViewOf(result)).toEqual({
      ...DEFAULT_VIEW,
      search: {
        capability: "web.search",
        provider: "auto",
        order: [],
        rows: [WRAPPER_ROW, { ...EXA_ROW, price: { asOf: "2026-01-05", stale: true } }],
      },
    });
  });

  test("notices pending lists the key plugins whose first use is not noticed yet, sorted by id", () => {
    const result: WebProvidersResult = {
      providers: [
        WRAPPER_STATUS,
        { ...EXA_STATUS, status: OK, firstUseNoticed: false, autoRank: 1 },
        provider("plugin:acme-search", "web.search", {
          origin: "plugin",
          displayName: "Acme",
          auth: "bearer",
          firstUseNoticed: false,
          autoRank: 2,
        }),
        provider("plugin:web-brave", "web.search", {
          origin: "plugin",
          displayName: "Brave",
          auth: "header",
          status: NO_KEY,
          firstUseNoticed: true,
          autoRank: 3,
        }),
        PLAYWRIGHT_STATUS,
        FETCH_STATUS,
      ],
      settings: DEFAULT_SETTINGS,
    };
    expect(toolsWebViewOf(result)).toEqual({
      ...DEFAULT_VIEW,
      search: {
        capability: "web.search",
        provider: "auto",
        order: [],
        rows: [
          WRAPPER_ROW,
          { ...EXA_ROW, ok: true, reason: null, note: "사용할 수 있다", noticePending: true },
          {
            id: "plugin:acme-search",
            capability: "web.search",
            displayName: "Acme",
            origin: "plugin",
            auth: "bearer",
            ok: true,
            reason: null,
            detail: null,
            note: "사용할 수 있다",
            rank: 2,
            current: false,
            pinned: false,
            noticePending: true,
            price: null,
          },
          {
            id: "plugin:web-brave",
            capability: "web.search",
            displayName: "Brave",
            origin: "plugin",
            auth: "header",
            ok: false,
            reason: "no-key",
            detail: null,
            note: "키가 없다 — 해결: xeon secret add brave-api-key",
            rank: 3,
            current: false,
            pinned: false,
            noticePending: false,
            price: null,
          },
        ],
      },
      recommendations: [
        {
          label: "Exa",
          providerId: "plugin:web-exa",
          secretName: "exa-api-key",
          state: "ready",
          hint: "",
        },
        {
          label: "Brave",
          providerId: "plugin:web-brave",
          secretName: "brave-api-key",
          state: "needs-key",
          hint: "xeon secret add brave-api-key",
        },
      ],
      noticesPending: ["plugin:acme-search", "plugin:web-exa"],
    });
  });

  test("robots does not follow by default and follows once it is not never", () => {
    const values: WebProvidersResult["settings"]["robots"][] = ["never", "auto", "always"];
    const views = values.map(
      (robots) =>
        toolsWebViewOf({ ...DEFAULT_RESULT, settings: { ...DEFAULT_SETTINGS, robots } }).robots,
    );
    expect(views).toEqual([
      { value: "never", follows: false },
      { value: "auto", follows: true },
      { value: "always", follows: true },
    ]);
  });

  test("recommendation states: ready, needs-key, not-installed and another unavailable reason", () => {
    const result: WebProvidersResult = {
      providers: [
        { ...EXA_STATUS, status: OK, firstUseNoticed: true },
        provider("plugin:web-brave", "web.search", {
          origin: "plugin",
          displayName: "Brave",
          auth: "header",
          status: { kind: "unavailable", reason: "unreachable" },
          firstUseNoticed: true,
          autoRank: 2,
        }),
      ],
      settings: DEFAULT_SETTINGS,
    };
    expect(toolsWebViewOf(result).recommendations).toEqual([
      {
        label: "Exa",
        providerId: "plugin:web-exa",
        secretName: "exa-api-key",
        state: "ready",
        hint: "",
      },
      {
        label: "Brave",
        providerId: "plugin:web-brave",
        secretName: "brave-api-key",
        state: "unavailable",
        hint: "unreachable",
      },
    ]);
  });

  test("the note maps known reasons to a Korean line and keeps an unknown reason as it is", () => {
    const reasons = [
      "unreachable",
      "json-disabled",
      "org-disabled",
      "unsupported-model",
      "new-reason",
    ];
    const result: WebProvidersResult = {
      providers: reasons.map((reason, index) =>
        provider(`plugin:r${index}`, "web.search", {
          status: { kind: "unavailable", reason },
          autoRank: index,
        }),
      ),
      settings: DEFAULT_SETTINGS,
    };
    expect(toolsWebViewOf(result).search.rows.map((row) => [row.reason, row.note])).toEqual([
      ["unreachable", "응답이 없다"],
      ["json-disabled", "JSON 응답이 꺼져 있다"],
      ["org-disabled", "조직 설정에서 막혀 있다"],
      ["unsupported-model", "현재 모델에서 쓸 수 없다"],
      ["new-reason", "new-reason"],
    ]);
  });

  test("the probe detail is cut to 200 characters and never reaches the note", () => {
    const result: WebProvidersResult = {
      providers: [
        provider("plugin:web-exa", "web.search", {
          origin: "plugin",
          displayName: "Exa",
          auth: "header",
          status: { kind: "unavailable", reason: "unreachable", detail: "d".repeat(300) },
          firstUseNoticed: true,
          autoRank: 0,
        }),
      ],
      settings: DEFAULT_SETTINGS,
    };
    expect(toolsWebViewOf(result).search.rows.map((row) => [row.detail, row.note])).toEqual([
      ["d".repeat(200), "응답이 없다"],
    ]);
  });
});

describe("orderUpdateOf", () => {
  const known = toolsWebViewOf(DEFAULT_RESULT);

  test("a drop of visible ids becomes a settings.set payload for the matching order key", () => {
    expect(orderUpdateOf("web.search", ["plugin:web-exa", "builtin-wrapper"], known)).toEqual({
      ok: true,
      value: { key: "l2.web.search.order", value: ["plugin:web-exa", "builtin-wrapper"] },
    });
    expect(orderUpdateOf("web.browse", ["playwright-mcp"], known)).toEqual({
      ok: true,
      value: { key: "l2.web.browse.order", value: ["playwright-mcp"] },
    });
  });

  test("an id that is not visible in that section is rejected, even if it is visible elsewhere", () => {
    expect(orderUpdateOf("web.search", ["builtin-wrapper", "plugin:web-brave"], known)).toEqual({
      ok: false,
      error: { kind: "unknown_id", id: "plugin:web-brave" },
    });
    expect(orderUpdateOf("web.browse", ["builtin-wrapper"], known)).toEqual({
      ok: false,
      error: { kind: "unknown_id", id: "builtin-wrapper" },
    });
  });

  test("a repeated id is rejected as a duplicate", () => {
    expect(orderUpdateOf("web.search", ["builtin-wrapper", "builtin-wrapper"], known)).toEqual({
      ok: false,
      error: { kind: "duplicate_id", id: "builtin-wrapper" },
    });
  });
});

describe("moveInOrder", () => {
  test("moves one item to the index it has after the move, and leaves out-of-range input unchanged", () => {
    const ids = ["a", "b", "c", "d"];
    type Case = readonly [number, number, readonly string[]];
    const cases: Case[] = [
      [0, 2, ["b", "c", "a", "d"]],
      [3, 1, ["a", "d", "b", "c"]],
      [2, 0, ["c", "a", "b", "d"]],
      [0, 3, ["b", "c", "d", "a"]],
      [1, 1, ["a", "b", "c", "d"]],
      [4, 0, ["a", "b", "c", "d"]],
      [-1, 0, ["a", "b", "c", "d"]],
      [0, 4, ["a", "b", "c", "d"]],
      [1.5, 0, ["a", "b", "c", "d"]],
    ];
    expect(cases.map(([from, to]): Case => [from, to, moveInOrder(ids, from, to)])).toEqual(cases);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  test("an out-of-range move returns a new array, not the input", () => {
    const ids = ["a", "b"];
    const moved = moveInOrder(ids, 2, 0);
    expect(moved).toEqual(["a", "b"]);
    expect(moved).not.toBe(ids);
  });
});
