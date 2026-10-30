import { afterEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, UI_LOCALE_KEY, type Locale } from "@xeon/client/i18n";
import { renderToString } from "react-dom/server";
import { createApp } from "../../src/app/bootstrap.ts";
import { localeOf } from "../../src/app/locale.ts";
import { setupRequiredText } from "../../src/views/setup-needed.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, until } from "./support.ts";

// 데스크톱 부트스트랩이 첫 렌더 전에 로케일을 정하고(WebView 언어 단서), 연결 뒤 `l4.ui.locale`과 무효화 알림을 따르는지 본다.
// 시험 프로세스는 ko로 시작하므로(scripts/test-preload.ts) 끝나면 되돌린다.

const KO = "모델 키와 기본 모델을 먼저 정해야";

afterEach(() => setActiveLocale("ko"));

function setting(value: unknown) {
  return {
    key: UI_LOCALE_KEY,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

/** 렌더되는 문장: 마이그레이션된 `desktop.setup.required`를 서버 렌더로 푼다 */
const rendered = (): string => renderToString(<p>{setupRequiredText()}</p>);

function makeAt(
  languages: readonly string[],
  onLocaleChange: (l: Locale) => void,
  stored: { v: unknown },
) {
  const engine = engineFake([summary(thr(1))], undefined, {
    results: {
      get "settings.get"() {
        return { settings: [setting(stored.v)] };
      },
    },
  });
  const app = createApp({
    ipc: engine.fake.ipc,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
      clearTimeout: (h) => clearTimeout(h),
    },
    frames: {
      requestAnimationFrame: (cb) => Number(setTimeout(() => cb(0), 0)),
      cancelAnimationFrame: (h) => clearTimeout(h),
    },
    monotonic: () => performance.now(),
    clipboard: { writeText: () => Promise.resolve() },
    appVersion: "0.0.0",
    frameFallbackMs: 20,
    logSink: () => {},
    languages,
    onLocaleChange,
  });
  return { app, fake: engine.fake, methods: engine.methods };
}

describe("localeOf", () => {
  test("setting wins, auto and missing follow the first language hint, unsupported hint is en", () => {
    expect(localeOf("en", ["ko-KR"])).toBe("en");
    expect(localeOf("ko", ["en-US"])).toBe("ko");
    expect(localeOf("auto", ["ko-KR", "en"])).toBe("ko");
    expect(localeOf(undefined, ["ko"])).toBe("ko");
    expect(localeOf(undefined, ["fr-FR"])).toBe("en");
    expect(localeOf(undefined, [])).toBe("en");
    expect(localeOf(7, ["ko"])).toBe("ko");
  });
});

describe("desktop locale bootstrap", () => {
  test("the language hint is applied when the app is created, before any render", () => {
    setActiveLocale("en");
    expect(rendered()).not.toContain(KO);
    const { app } = makeAt(["ko-KR"], () => {}, { v: "auto" });
    expect(activeLocale()).toBe("ko");
    expect(rendered()).toContain(KO);
    return app.stop();
  });

  test("after connecting, l4.ui.locale overrides the hint and settings.invalidated re-reads it", async () => {
    const changes: Locale[] = [];
    const stored: { v: unknown } = { v: "en" };
    const { app, fake } = makeAt(["ko-KR"], (l) => changes.push(l), stored);
    expect(activeLocale()).toBe("ko");
    await until(() => changes.length === 1, "locale read after connect");
    expect(changes).toEqual(["en"]);
    expect(rendered()).not.toContain(KO);
    stored.v = "ko";
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [UI_LOCALE_KEY], scopes: ["user"], threadId: null },
    });
    await until(() => changes.length === 2, "locale re-read after invalidation");
    expect(changes).toEqual(["en", "ko"]);
    expect(rendered()).toContain(KO);
    await app.stop();
  });

  test("without language hints the locale is left alone", async () => {
    setActiveLocale("en");
    const engine = engineFake();
    const app = createApp({
      ipc: engine.fake.ipc,
      clock: { now: () => 0 },
      scheduler: {
        setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
        clearTimeout: (h) => clearTimeout(h),
      },
      frames: {
        requestAnimationFrame: (cb) => Number(setTimeout(() => cb(0), 0)),
        cancelAnimationFrame: (h) => clearTimeout(h),
      },
      monotonic: () => 0,
      clipboard: { writeText: () => Promise.resolve() },
      appVersion: "0.0.0",
      frameFallbackMs: 20,
      logSink: () => {},
    });
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    expect(activeLocale()).toBe("en");
    await app.stop();
  });
});
