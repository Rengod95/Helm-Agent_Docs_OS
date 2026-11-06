import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ToolsWebView, WebSection, WebToolRow } from "@fresnel/client";
import { renderToString } from "react-dom/server";
import {
  ToolsWebPanelView,
  type ToolsWebViewProps,
  type WebLoad,
} from "../../src/views/pages/tools-web/tools-web-view.tsx";
import { visibleWebViewOf } from "../../src/views/pages/tools-web/tools-web-model.ts";

// 도구와 웹 패널(P-12)의 서버 렌더. 읽는 중, 읽지 못함, 오프라인, 빈 목록, 긴 목록, 준비된 값을 그린다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 order-keys와 tools-web-model 시험이 본다). 문장은 `t()`로 비교한다.

const NOOP = (): void => {};

function row(id: string, fields: Partial<WebToolRow> = {}): WebToolRow {
  return {
    id,
    capability: "web.search",
    displayName: id,
    origin: "plugin",
    auth: "header",
    ok: true,
    reason: null,
    detail: null,
    note: "사용할 수 있어요",
    rank: 0,
    current: false,
    pinned: false,
    noticePending: false,
    price: null,
    ...fields,
  };
}

function emptySection(capability: WebSection["capability"]): WebSection {
  return { capability, provider: "auto", order: [], rows: [] };
}

/** 검색 행 세 개, 브라우저 행 없음, 권장 Exa(키 없음)와 Brave(설치 안 됨)를 가진 값. SearXNG는 화면 값에서 이미 빠져 있다 */
const READY: ToolsWebView = {
  search: {
    capability: "web.search",
    provider: "auto",
    order: ["plugin:web-exa"],
    rows: [
      row("builtin-wrapper", { displayName: "내장 검색", rank: 0, current: true }),
      row("plugin:web-exa", {
        displayName: "Exa",
        ok: false,
        reason: "no-key",
        note: "키가 없어요 — 해결: fresnel secret add exa-api-key",
        rank: 1,
        noticePending: true,
      }),
      row("plugin:web-brave", {
        displayName: "Brave",
        ok: false,
        reason: "unreachable",
        note: "응답이 없어요",
        rank: 2,
        price: { asOf: "2026-08-01", stale: true },
      }),
    ],
  },
  browse: emptySection("web.browse"),
  fetch: emptySection("web.fetch"),
  parallel: 1,
  robots: { value: "never", follows: false },
  recommendations: [
    {
      label: "Exa",
      providerId: "plugin:web-exa",
      secretName: "exa-api-key",
      state: "needs-key",
      hint: "fresnel secret add exa-api-key",
    },
    {
      label: "Brave",
      providerId: "plugin:web-brave",
      secretName: "brave-api-key",
      state: "not-installed",
      hint: "플러그인을 설치해 주세요",
    },
  ],
  noticesPending: ["plugin:web-exa"],
};

function propsOf(load: WebLoad, over: Partial<ToolsWebViewProps> = {}): ToolsWebViewProps {
  return { load, offline: false, saveError: null, onMove: NOOP, onRetry: NOOP, ...over };
}

describe("ToolsWebPanelView states", () => {
  test("reading shows the status line and skeleton rows", () => {
    const html = renderToString(<ToolsWebPanelView {...propsOf({ status: "loading" })} />);
    expect(html).toContain(t("desktop.tools.loading"));
    expect(html).not.toContain(t("desktop.tools.offline"));
  });

  test("offline before any reading says so and does not show the loading line", () => {
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "loading" }, { offline: true })} />,
    );
    expect(html).toContain(t("desktop.tools.offline"));
    expect(html).not.toContain(t("desktop.tools.loading"));
  });

  test("a failed reading shows its message with a retry button", () => {
    const html = renderToString(
      <ToolsWebPanelView
        {...propsOf({ status: "failed", message: t("desktop.tools.load.failed") })}
      />,
    );
    expect(html).toContain(t("desktop.tools.load.failed"));
    expect(html).toContain(t("desktop.tools.retry"));
  });

  test("a save failure stays under the search list", () => {
    const html = renderToString(
      <ToolsWebPanelView
        {...propsOf(
          { status: "ready", view: READY },
          { saveError: t("desktop.tools.order.saveFailed") },
        )}
      />,
    );
    expect(html).toContain(t("desktop.tools.order.saveFailed"));
  });
});

describe("ToolsWebPanelView ready values", () => {
  test("a ready provider shows no state text, a provider with a problem shows its state, and its note sits behind the info icon", () => {
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: READY })} />,
    );
    expect(html).not.toContain(t("desktop.tools.state.ready"));
    expect(html).toContain(t("desktop.tools.state.needsKey"));
    expect(html).toContain(t("desktop.tools.state.unavailable"));
    expect(html).toContain(t("desktop.tools.current"));
    expect(html).toContain(t("desktop.tools.notice.pending"));
    expect(html).toContain(t("desktop.tools.price.stale"));
    // 설명은 정보 아이콘의 이름으로만 남는다(툴팁은 열 때만 그린다)
    expect(html).toContain("fresnel secret add exa-api-key");
  });

  test("the recommendations show Exa and Brave with their own states", () => {
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: READY })} />,
    );
    expect(html).toContain(t("desktop.tools.recommend.title"));
    expect(html).toContain(t("desktop.tools.state.notInstalled"));
    expect(html).toContain("플러그인을 설치해 주세요");
  });

  test("an empty browser and fetch list say so, and a first-use notice shows on its row", () => {
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: READY })} />,
    );
    expect(html).toContain(t("desktop.tools.browse.empty"));
    expect(html).toContain(t("desktop.tools.fetch.title"));
    expect(html).toContain(t("desktop.tools.fetch.empty"));
    expect(html).toContain(t("desktop.tools.notice.pending"));
  });

  test("SearXNG never appears in the rendered value, and the pinned line names the id when pinned", () => {
    const pinned: ToolsWebView = {
      ...READY,
      search: { ...READY.search, provider: "plugin:web-exa" },
    };
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: pinned })} />,
    );
    expect(html).toContain(t("desktop.tools.search.pinned", { id: "plugin:web-exa" }));
    expect(html).not.toContain("SearXNG");
    expect(html).not.toContain("searxng");
  });

  test("a long list of providers renders every row, in its order", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      row(`plugin:web-p${String(index)}`, {
        displayName: `Provider ${String(index)}`,
        rank: index,
      }),
    );
    const long: ToolsWebView = { ...READY, search: { ...READY.search, order: [], rows } };
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: long })} />,
    );
    expect(html).toContain("Provider 0<");
    expect(html).toContain("Provider 29<");
  });

  test("a value with the SearXNG row removed renders as the visible value", () => {
    const raw: ToolsWebView = {
      ...READY,
      search: {
        ...READY.search,
        rows: [
          ...READY.search.rows,
          row("plugin:web-searxng", { displayName: "SearXNG", rank: 3 }),
        ],
      },
    };
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: visibleWebViewOf(raw) })} />,
    );
    expect(html).not.toContain("SearXNG");
  });
});

describe("ToolsWebPanelView editing lock", () => {
  test("the search rows are focusable only while the order can be changed", () => {
    // 가격 오래됨 글도 툴팁 대상이라 초점을 받는다. 순서 잠금만 보려고 가격 줄을 뺀 값으로 본다
    const noPrice: ToolsWebView = {
      ...READY,
      search: { ...READY.search, rows: READY.search.rows.map((r) => ({ ...r, price: null })) },
    };
    const live = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: noPrice })} />,
    );
    const offline = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: noPrice }, { offline: true })} />,
    );
    expect(live).toContain('tabindex="0"');
    expect(offline).not.toContain('tabindex="0"');
  });

  test("an empty search list says no search tools", () => {
    const none: ToolsWebView = { ...READY, search: emptySection("web.search") };
    const html = renderToString(
      <ToolsWebPanelView {...propsOf({ status: "ready", view: none })} />,
    );
    expect(html).toContain(t("desktop.tools.search.empty"));
    expect(html).toContain(t("desktop.tools.search.auto"));
  });
});
