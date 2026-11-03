import { describe, expect, test } from "bun:test";
import type { ToolsWebView, WebSection, WebToolRow } from "@fresnel/client";
import { keyboardMoveOf, movedOrderOf } from "../../src/views/pages/shared/order-keys.ts";
import {
  displayOrderOf,
  isRemovedProvider,
  pinnedOf,
  providerStateOf,
  visibleWebViewOf,
} from "../../src/views/pages/tools-web/tools-web-model.ts";
import { orderErrorIdOf } from "../../src/views/pages/tools-web/tools-web-text.ts";

// 도구와 웹 화면(P-12)의 순수 모델. 값은 `toEqual`로 비교한다. SearXNG는 행, 순서, 고지에서 빠진다(B15).

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

function searchOf(
  provider: string,
  order: readonly string[],
  rows: readonly WebToolRow[],
): WebSection {
  return { capability: "web.search", provider, order: [...order], rows: [...rows] };
}

function viewOf(search: WebSection, notices: readonly string[]): ToolsWebView {
  const empty: WebSection = { capability: "web.browse", provider: "auto", order: [], rows: [] };
  return {
    search,
    browse: empty,
    fetch: { ...empty, capability: "web.fetch" },
    parallel: 1,
    robots: { value: "never", follows: false },
    recommendations: [],
    noticesPending: [...notices],
  };
}

describe("visibleWebViewOf", () => {
  test("a SearXNG row, its order entry, its pin and its notice are dropped; the other rows keep their rank order", () => {
    const search = searchOf(
      "plugin:web-searxng",
      ["plugin:web-searxng", "plugin:web-exa"],
      [
        row("builtin-wrapper", { displayName: "내장 검색", rank: 0 }),
        row("plugin:web-searxng", { displayName: "SearXNG", rank: 1 }),
        row("plugin:web-exa", { displayName: "Exa", rank: 2 }),
      ],
    );
    const visible = visibleWebViewOf(viewOf(search, ["plugin:web-exa", "plugin:web-searxng"]));
    expect(visible.search.provider).toBe("auto");
    expect(visible.search.order).toEqual(["plugin:web-exa"]);
    expect(visible.search.rows.map((item) => item.id)).toEqual([
      "builtin-wrapper",
      "plugin:web-exa",
    ]);
    expect(visible.noticesPending).toEqual(["plugin:web-exa"]);
  });

  test("a view without SearXNG comes back unchanged", () => {
    const search = searchOf("auto", [], [row("builtin-wrapper", { displayName: "내장 검색" })]);
    const view = viewOf(search, []);
    expect(visibleWebViewOf(view)).toEqual(view);
  });
});

describe("isRemovedProvider", () => {
  test("matches SearXNG by id or display name in any letter case", () => {
    expect(isRemovedProvider({ id: "x", displayName: "SearXNG" })).toBe(true);
    expect(isRemovedProvider({ id: "plugin:web-SearXNG", displayName: "x" })).toBe(true);
    expect(isRemovedProvider({ id: "plugin:web-exa", displayName: "Exa" })).toBe(false);
  });
});

describe("providerStateOf", () => {
  test("ok is ready, no-key is needs-key, any other reason is unavailable", () => {
    expect(providerStateOf({ ok: true, reason: null })).toBe("ready");
    expect(providerStateOf({ ok: false, reason: "no-key" })).toBe("needs-key");
    expect(providerStateOf({ ok: false, reason: "unreachable" })).toBe("unavailable");
  });
});

describe("displayOrderOf", () => {
  const search = searchOf(
    "auto",
    ["plugin:web-exa", "gone", "builtin-wrapper", "plugin:web-exa"],
    [
      row("builtin-wrapper", { rank: 0 }),
      row("plugin:web-exa", { rank: 1 }),
      row("plugin:web-brave", { rank: 2 }),
    ],
  );

  test("the stored order first, visible ids once, then the rows the stored order does not name", () => {
    expect(displayOrderOf(search)).toEqual([
      "plugin:web-exa",
      "builtin-wrapper",
      "plugin:web-brave",
    ]);
  });

  test("an empty stored order keeps the rank order of the rows", () => {
    expect(displayOrderOf({ ...search, order: [] })).toEqual([
      "builtin-wrapper",
      "plugin:web-exa",
      "plugin:web-brave",
    ]);
  });
});

describe("pinnedOf", () => {
  test("auto is no pin, an id is the pinned provider", () => {
    expect(pinnedOf(searchOf("auto", [], []))).toBeNull();
    expect(pinnedOf(searchOf("plugin:web-exa", [], []))).toBe("plugin:web-exa");
  });
});

describe("keyboard move on a focused row", () => {
  test("ArrowUp and ArrowDown move one place, the ends do not move", () => {
    expect(keyboardMoveOf("ArrowUp", 1, 3)).toEqual({ from: 1, to: 0 });
    expect(keyboardMoveOf("ArrowDown", 1, 3)).toEqual({ from: 1, to: 2 });
    expect(keyboardMoveOf("ArrowDown", 2, 3)).toBeNull();
    expect(keyboardMoveOf("ArrowUp", 0, 3)).toBeNull();
  });

  test("other keys and out-of-range rows do nothing", () => {
    expect(keyboardMoveOf("Enter", 1, 3)).toBeNull();
    expect(keyboardMoveOf("ArrowDown", 5, 3)).toBeNull();
  });

  test("the moved order takes the row to its new place", () => {
    expect(movedOrderOf(["a", "b", "c"], { from: 0, to: 2 })).toEqual(["b", "c", "a"]);
    expect(movedOrderOf(["a", "b", "c"], { from: 2, to: 0 })).toEqual(["c", "a", "b"]);
  });
});

describe("orderErrorIdOf", () => {
  test("each order check error has its own message id", () => {
    expect(orderErrorIdOf({ kind: "unknown_id", id: "x" })).toBe(
      "desktop.tools.order.error.unknownId",
    );
    expect(orderErrorIdOf({ kind: "duplicate_id", id: "x" })).toBe(
      "desktop.tools.order.error.duplicateId",
    );
  });
});
