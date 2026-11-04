import { err, ok, type Result } from "@fresnel/contracts";
import type {
  BrowserEnginePort,
  EngineError,
  EngineOpenOptions,
  EngineScreenshot,
  EngineSession,
  EngineSnapshot,
} from "../ports/browser-engine.ts";

// 가짜 브라우저 엔진 포트(L2.web.spec §4.10.4a). 페이지마다 스냅샷을 스크립트하고 동작 호출을 기록한다.
// 기본 페이지는 §4.10.4a의 예시 트리다. 주소가 스크립트에 없으면 이 페이지를 보이고, 주소는 마지막으로 연 주소를 따라간다.

/** 예시 트리. frame-node id `0-11`이 버튼 "Pay now"다 */
const EXAMPLE_TREE: string = [
  "[0-2] RootWebArea: T",
  "  [0-5] scrollable, html",
  "    [0-4] body",
  "      [0-9] heading: Hi",
  "      [0-11] button: Pay now",
  "      [0-13] link: link",
  "      [0-3] textbox: Name",
].join("\n");

const EXAMPLE_XPATHS: Readonly<Record<string, string>> = {
  "0-2": "/",
  "0-5": "/html[1]",
  "0-4": "/html[1]/body[1]",
  "0-9": "/html[1]/body[1]/h1[1]",
  "0-11": "/html[1]/body[1]/button[1]",
  "0-13": "/html[1]/body[1]/a[1]",
  "0-3": "/html[1]/body[1]/input[1]",
};

const EXAMPLE_URLS: Readonly<Record<string, string>> = {
  "0-13": "https://example.com/x",
};

export interface FakeEnginePage {
  readonly title: string;
  readonly formattedTree: string;
  readonly xpathMap: Readonly<Record<string, string>>;
  readonly urlMap: Readonly<Record<string, string>>;
  /** `readText`가 돌려주는 본문 */
  readonly text?: string;
  /** XPath → 폼 action 주소. 없는 요소는 폼이 없다 */
  readonly formActions?: Readonly<Record<string, string>>;
}

export const EXAMPLE_PAGE: FakeEnginePage = {
  title: "Shop",
  formattedTree: EXAMPLE_TREE,
  xpathMap: EXAMPLE_XPATHS,
  urlMap: EXAMPLE_URLS,
  text: "Shop text",
};

/** 기록되는 동작 호출. 스냅샷과 이동 목록 읽기는 기록하지 않는다 */
type EngineCall =
  | { readonly method: "goto"; readonly url: string }
  | { readonly method: "click"; readonly xpath: string }
  | { readonly method: "fill"; readonly xpath: string; readonly text: string }
  | { readonly method: "typeText"; readonly text: string }
  | { readonly method: "pressKey"; readonly key: string }
  | { readonly method: "scroll"; readonly deltaX: number; readonly deltaY: number }
  | { readonly method: "selectOption"; readonly xpath: string; readonly values: readonly string[] }
  | { readonly method: "waitMs"; readonly ms: number }
  | { readonly method: "screenshot" }
  | { readonly method: "readText" }
  | { readonly method: "formAction"; readonly xpath: string }
  | { readonly method: "close" };

export interface FakeBrowserEngineScript {
  /** 탐침 결과. 기본은 설치됨 */
  readonly available?: { readonly ok: true } | { readonly ok: false; readonly detail: string };
  /** 주소 → 페이지 */
  readonly pages?: Readonly<Record<string, FakeEnginePage>>;
  /** `screenshot`이 돌려주는 값. 기본은 1×1이 아닌 PNG */
  readonly screenshot?: EngineScreenshot;
}

export interface FakeBrowserEngine extends BrowserEnginePort {
  /** 받은 `open` 옵션(순서대로) */
  readonly opens: EngineOpenOptions[];
  /** 열린 세션이 받은 동작 호출(순서대로) */
  readonly calls: EngineCall[];
  /** 주소의 페이지를 바꾼다. 다음 스냅샷부터 보인다 */
  setPage(url: string, page: FakeEnginePage): void;
  /** 다음 동작이 일으킬 최상위 이동. 한 번 쓰고 비운다 */
  redirectNextTo(url: string): void;
  /** 다음 동작이 이 오류로 실패한다. 한 번 쓰고 비운다 */
  failNextWith(error: EngineError): void;
  /** 다음 `open`이 이 오류로 실패한다. 한 번 쓰고 비운다 */
  failNextOpenWith(error: EngineError): void;
}

const DEFAULT_SCREENSHOT: EngineScreenshot = {
  mediaType: "image/png",
  data: "iVBORw0KGgo=",
  width: 800,
  height: 600,
};

export function fakeBrowserEngine(script: FakeBrowserEngineScript = {}): FakeBrowserEngine {
  const opens: EngineOpenOptions[] = [];
  const calls: EngineCall[] = [];
  const pages = new Map<string, FakeEnginePage>(Object.entries(script.pages ?? {}));
  let redirect: string | undefined;
  let failure: EngineError | undefined;
  let openFailure: EngineError | undefined;

  function pageAt(url: string): FakeEnginePage {
    return pages.get(url) ?? EXAMPLE_PAGE;
  }

  /** 예약된 실패를 한 번 꺼낸다 */
  function takeFailure(): EngineError | undefined {
    const error = failure;
    failure = undefined;
    return error;
  }

  function sessionOf(): EngineSession {
    let currentUrl = "about:blank";
    let queued: string[] = [];

    /** 예약된 이동을 한 번 적용한다. 동작이 끝난 뒤에 일어나는 최상위 이동이다 */
    function applyRedirect(): void {
      if (redirect === undefined) return;
      currentUrl = redirect;
      queued = [...queued, redirect];
      redirect = undefined;
    }

    /** 동작 호출 하나. 예약된 실패가 있으면 페이지를 바꾸지 않고 실패한다 */
    function acted(call: EngineCall): Result<void, EngineError> {
      calls.push(call);
      const error = takeFailure();
      if (error !== undefined) return err(error);
      applyRedirect();
      return ok(undefined);
    }

    return {
      goto(url) {
        calls.push({ method: "goto", url });
        const error = takeFailure();
        if (error !== undefined) return Promise.resolve(err(error));
        currentUrl = url;
        queued = [...queued, url];
        applyRedirect();
        return Promise.resolve(ok(undefined));
      },
      snapshot() {
        const page = pageAt(currentUrl);
        const snapshot: EngineSnapshot = {
          url: currentUrl,
          title: page.title,
          formattedTree: page.formattedTree,
          xpathMap: page.xpathMap,
          urlMap: page.urlMap,
        };
        return Promise.resolve(ok(snapshot));
      },
      click(xpath) {
        return Promise.resolve(acted({ method: "click", xpath }));
      },
      fill(xpath, text) {
        return Promise.resolve(acted({ method: "fill", xpath, text }));
      },
      typeText(text) {
        return Promise.resolve(acted({ method: "typeText", text }));
      },
      pressKey(key) {
        return Promise.resolve(acted({ method: "pressKey", key }));
      },
      scroll(deltaX, deltaY) {
        return Promise.resolve(acted({ method: "scroll", deltaX, deltaY }));
      },
      selectOption(xpath, values) {
        return Promise.resolve(acted({ method: "selectOption", xpath, values }));
      },
      waitMs(ms) {
        return Promise.resolve(acted({ method: "waitMs", ms }));
      },
      screenshot() {
        calls.push({ method: "screenshot" });
        return Promise.resolve(ok(script.screenshot ?? DEFAULT_SCREENSHOT));
      },
      readText() {
        calls.push({ method: "readText" });
        return Promise.resolve(ok(pageAt(currentUrl).text ?? ""));
      },
      formAction(xpath) {
        calls.push({ method: "formAction", xpath });
        return Promise.resolve(ok(pageAt(currentUrl).formActions?.[xpath]));
      },
      navigations() {
        const drained = queued;
        queued = [];
        return drained;
      },
      close() {
        calls.push({ method: "close" });
        return Promise.resolve(ok(undefined));
      },
    };
  }

  return {
    opens,
    calls,
    available: () => Promise.resolve(script.available ?? { ok: true }),
    open(options) {
      opens.push(options);
      if (openFailure !== undefined) {
        const error = openFailure;
        openFailure = undefined;
        return Promise.resolve(err(error));
      }
      return Promise.resolve(ok(sessionOf()));
    },
    setPage(url, page) {
      pages.set(url, page);
    },
    redirectNextTo(url) {
      redirect = url;
    },
    failNextWith(error) {
      failure = error;
    },
    failNextOpenWith(error) {
      openFailure = error;
    },
  };
}
