import { describe, expect, test } from "bun:test";
import { orderUpdateOf } from "@fresnel/client";
import { keyboardMoveOf, movedOrderOf } from "../../src/views/pages/shared/order-keys.ts";
import {
  displayOrderOf,
  visibleWebViewOf,
} from "../../src/views/pages/tools-web/tools-web-model.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 도구와 웹 화면(P-12)을 가짜 엔진 위에서 돌린다. 순서 저장은 `settings.set`의 정확한 인자로 본다.
// 키 입력은 DOM이 없어 `keyboardMoveOf`로 뜻만 가져오고, 그다음의 저장 경로는 화면이 쓰는 것과 같다.

const KEY = "l2.web.search.order";

const WEB_RESULT = {
  providers: [
    {
      id: "builtin-wrapper",
      capability: "web.search",
      origin: "builtin",
      displayName: "내장 검색",
      auth: "none",
      status: { kind: "ok" },
      pricingAsOf: null,
      pricingStale: false,
      firstUseNoticed: true,
      autoRank: 0,
    },
    {
      id: "plugin:web-exa",
      capability: "web.search",
      origin: "plugin",
      displayName: "Exa",
      auth: "header",
      status: { kind: "unavailable", reason: "no-key" },
      pricingAsOf: "2026-10-01",
      pricingStale: false,
      firstUseNoticed: false,
      autoRank: 1,
    },
    {
      id: "plugin:web-brave",
      capability: "web.search",
      origin: "plugin",
      displayName: "Brave",
      auth: "header",
      status: { kind: "ok" },
      pricingAsOf: null,
      pricingStale: false,
      firstUseNoticed: true,
      autoRank: 2,
    },
    {
      id: "plugin:web-searxng",
      capability: "web.search",
      origin: "plugin",
      displayName: "SearXNG",
      auth: "none",
      status: { kind: "ok" },
      pricingAsOf: null,
      pricingStale: false,
      firstUseNoticed: true,
      autoRank: 3,
    },
  ],
  settings: {
    searchProvider: "auto",
    searchOrder: [],
    searchParallel: 1,
    browseProvider: "auto",
    browseOrder: [],
    robots: "never",
  },
};

/** 쓴 값을 돌려주는 설정 응답. 모양은 와이어 `EffectiveSetting`이다 */
const SAVED = {
  key: KEY,
  value: [],
  source: { scope: "user" },
  locked: false,
  shadowed: [],
  runtimeChange: "live",
  pendingUntil: null,
  deprecated: false,
};

const EXTRA: EngineExtra = {
  results: { "web.providers": WEB_RESULT, "settings.set": { setting: SAVED } },
};

async function liveApp(extra: EngineExtra = EXTRA) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("tools and web page commands", () => {
  test("web-order.keyboard-move-saves", async () => {
    const { app, params } = await liveApp();
    const listed = await app.commands.web.providers();
    if (!listed.ok) throw new Error("web.providers must read");
    const view = visibleWebViewOf(listed.value);
    const ids = displayOrderOf(view.search);
    expect(ids).toEqual(["builtin-wrapper", "plugin:web-exa", "plugin:web-brave"]);

    // Exa는 두 번째 행이다. ↑ 한 번이면 맨 앞으로 간다
    const move = keyboardMoveOf("ArrowUp", 1, ids.length);
    if (move === null) throw new Error("ArrowUp from the second row must move it");
    const update = orderUpdateOf("web.search", movedOrderOf(ids, move), view);
    if (!update.ok) throw new Error("the moved order must pass the check");

    const saved = await app.commands.web.setOrder(update.value);
    expect(saved.ok).toBe(true);
    expect(params.filter((entry) => entry.method === "settings.set")).toEqual([
      {
        method: "settings.set",
        params: {
          key: "l2.web.search.order",
          value: ["plugin:web-exa", "builtin-wrapper", "plugin:web-brave"],
          scope: "user",
        },
      },
    ]);
    await app.stop();
  });

  test("ArrowDown on the first row moves it down and saves the new order", async () => {
    const { app, params } = await liveApp();
    const listed = await app.commands.web.providers();
    if (!listed.ok) throw new Error("web.providers must read");
    const view = visibleWebViewOf(listed.value);
    const ids = displayOrderOf(view.search);
    // ↓은 첫 행을 두 번째로 내린다
    const move = keyboardMoveOf("ArrowDown", 0, ids.length);
    if (move === null) throw new Error("ArrowDown from the first row must move it");
    const update = orderUpdateOf("web.search", movedOrderOf(ids, move), view);
    if (!update.ok) throw new Error("the moved order must pass the check");
    expect(await app.commands.web.setOrder(update.value)).toEqual({ ok: true, value: null });
    expect(params.filter((entry) => entry.method === "settings.set")).toEqual([
      {
        method: "settings.set",
        params: {
          key: "l2.web.search.order",
          value: ["plugin:web-exa", "builtin-wrapper", "plugin:web-brave"],
          scope: "user",
        },
      },
    ]);
    await app.stop();
  });

  test("an order that names a provider the page does not show is refused without a write", async () => {
    const { app, params } = await liveApp();
    const listed = await app.commands.web.providers();
    if (!listed.ok) throw new Error("web.providers must read");
    const view = visibleWebViewOf(listed.value);
    expect(orderUpdateOf("web.search", ["plugin:web-searxng"], view)).toEqual({
      ok: false,
      error: { kind: "unknown_id", id: "plugin:web-searxng" },
    });
    expect(params.filter((entry) => entry.method === "settings.set")).toEqual([]);
    await app.stop();
  });
});
