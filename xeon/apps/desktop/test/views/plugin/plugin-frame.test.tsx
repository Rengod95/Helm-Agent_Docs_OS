import { describe, expect, test } from "bun:test";
import type { ThemePush } from "@fresnel/client/views/app";
import {
  createScreenLedger,
  LEDGER_DISABLE_AFTER,
  type ScreenLedger,
} from "@fresnel/client/views/ledger";
import { renderToString } from "react-dom/server";
import {
  clampFrameHeight,
  PluginFrame,
  type PluginFrameProps,
} from "../../../src/views/plugin/plugin-frame.tsx";

const SCREEN = "helm/panel";

/** 서버 렌더는 효과를 돌리지 않으므로 이 콜백들은 호출되지 않는다 */
const notCalled = (): never => {
  throw new Error("not called during server render");
};

const THEME: ThemePush = {
  tokens: {},
  scheme: "light",
  density: "comfortable",
  locale: "ko",
  reducedMotion: false,
  hangulWordBreak: "keep-all",
};

function props(ledger: ScreenLedger): PluginFrameProps {
  return {
    screenKey: SCREEN,
    url: "fresnel-view://helm/1.0.0/index.html#n=abcdefgh",
    nonce: "abcdefgh",
    declaredBridge: "1.0.0",
    ledger,
    context: notCalled,
    makeBackend: notCalled,
    confirm: () => Promise.resolve("deny"),
    theme: () => THEME,
    title: "Helm panel",
    onClosed: notCalled,
  };
}

describe("PluginFrame", () => {
  test("draws an iframe with the given title and only the isolating sandbox token", () => {
    const html = renderToString(<PluginFrame {...props(createScreenLedger())} />);
    expect(html).toContain("<iframe");
    expect(html).toContain('title="Helm panel"');
    // 샌드박스 값은 FRAME_SANDBOX 상수 하나다. 넓히는 토큰(allow-same-origin 등)은 어디에도 없다
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  test("draws the disabled placeholder instead of the iframe when the ledger already disabled the screen", () => {
    const ledger = createScreenLedger();
    for (let failure = 0; failure < LEDGER_DISABLE_AFTER; failure += 1) {
      ledger.fail(SCREEN, "query_failed");
    }
    const html = renderToString(<PluginFrame {...props(ledger)} />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("이 화면이 꺼졌어요. 다시 켜면 처음부터 다시 불러와요.");
    expect(html).toContain("다시 켜기");
  });

  test("keeps the iframe while the screen has failed fewer times than the limit", () => {
    const ledger = createScreenLedger();
    for (let failure = 0; failure < LEDGER_DISABLE_AFTER - 1; failure += 1) {
      ledger.fail(SCREEN, "query_failed");
    }
    expect(renderToString(<PluginFrame {...props(ledger)} />)).toContain("<iframe");
  });
});

describe("clampFrameHeight", () => {
  test("keeps a height inside 80 to 800 px and rounds it to a whole pixel", () => {
    expect(clampFrameHeight(300.6)).toBe(301);
    expect(clampFrameHeight(300.4)).toBe(300);
    expect(clampFrameHeight(80)).toBe(80);
    expect(clampFrameHeight(800)).toBe(800);
  });

  test("raises a height below 80 px to 80 and lowers one above 800 px to 800", () => {
    expect(clampFrameHeight(10)).toBe(80);
    expect(clampFrameHeight(0)).toBe(80);
    expect(clampFrameHeight(-40)).toBe(80);
    expect(clampFrameHeight(5000)).toBe(800);
    expect(clampFrameHeight(79.4)).toBe(80);
  });

  test("ignores a height that is not finite", () => {
    expect(clampFrameHeight(Number.NaN)).toBeUndefined();
    expect(clampFrameHeight(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampFrameHeight(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });
});
