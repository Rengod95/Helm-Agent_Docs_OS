import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Logger, Result } from "@fresnel/contracts";
import {
  createStagehandEnginePort,
  type LaunchedPage,
  type LaunchOptions,
  type Launcher,
} from "../../src/assembly/web-stagehand.ts";

// L2.web.spec §4.10.4a. Stagehand 어댑터(`BrowserEnginePort`)를 가짜 실행기와 가짜 페이지로 시험한다. Chrome은 띄우지 않는다.
// 맨 아래의 실제 Chrome 시험은 FRESNEL_LIVE_BROWSER=1이고 Chrome이 있을 때만 돈다.

const LIVE_SIGNAL = new AbortController().signal;
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE_URL = "https://shop.example/";
const TREE = {
  formattedTree: [
    "[0-2] RootWebArea: Shop",
    "  [0-4] body",
    "    [0-9] heading: Hi",
    "    [0-11] button: Pay now",
    "    [0-13] link: link",
  ].join("\n"),
  xpathMap: { "0-11": "/html[1]/body[1]/button[1]" },
  urlMap: { "0-13": "https://example.com/x" },
};
/** 1280x800 PNG의 시그니처와 IHDR까지만 있는 바이트 */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x05,
  0x00, 0, 0, 0x03, 0x20, 8, 6, 0, 0, 0,
]);
const SILENT: Pick<Logger, "warn"> = { warn: () => undefined };

/** Result의 값을 꺼낸다. 오류면 시험을 실패시킨다 */
function okOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function launchAt(list: readonly LaunchOptions[], index: number): LaunchOptions {
  const found = list[index];
  if (found === undefined) throw new Error(`no launch at ${String(index)}`);
  return found;
}

interface FakeOptions {
  readonly url?: string;
  /** `formAction` 스크립트의 응답(폼의 action 속성, 없으면 null). 생략하면 null이다 */
  readonly form?: string | null;
  /** 클릭이 최상위 문서를 옮기는 새 주소 */
  readonly clickMovesTo?: string;
  /** 클릭의 응답. 생략하면 바로 끝난다 */
  readonly click?: () => Promise<void>;
}

/** 가짜 페이지. 동작 호출을 `log`에 쌓는다. 주소와 읽기 호출은 기록하지 않는다 */
function fakePage(options: FakeOptions = {}): {
  readonly page: LaunchedPage;
  readonly log: string[];
} {
  const log: string[] = [];
  let url = options.url ?? PAGE_URL;
  const page: LaunchedPage = {
    goto: (next) => {
      log.push(`goto ${next}`);
      url = next;
      return Promise.resolve(null);
    },
    url: () => Promise.resolve(url),
    title: () => Promise.resolve("Shop"),
    snapshot: () => Promise.resolve(TREE),
    locator: (selector) => ({
      click: () => {
        log.push(`click ${selector}`);
        if (options.clickMovesTo !== undefined) url = options.clickMovesTo;
        return options.click?.() ?? Promise.resolve();
      },
      fill: (value) => {
        log.push(`fill ${selector} ${value}`);
        return Promise.resolve();
      },
      selectOption: (values) => {
        log.push(`select ${selector} ${values.join(",")}`);
        return Promise.resolve(values);
      },
      innerText: () => {
        log.push(`innerText ${selector}`);
        return Promise.resolve("Shop text");
      },
    }),
    evaluate: (expression) => {
      if (expression === "Math.round(innerWidth / 2)") return Promise.resolve(640);
      if (expression === "Math.round(innerHeight / 2)") return Promise.resolve(400);
      return Promise.resolve(options.form === undefined ? null : options.form);
    },
    type: (text) => {
      log.push(`type ${text}`);
      return Promise.resolve();
    },
    keyPress: (key) => {
      log.push(`key ${key}`);
      return Promise.resolve();
    },
    scroll: (x, y, deltaX, deltaY) => {
      log.push(`scroll ${String(x)} ${String(y)} ${String(deltaX)} ${String(deltaY)}`);
      return Promise.resolve();
    },
    waitForTimeout: (ms) => {
      log.push(`wait ${String(ms)}`);
      return Promise.resolve();
    },
    screenshot: (shot) => {
      log.push(`screenshot ${shot.type}`);
      return Promise.resolve(PNG);
    },
  };
  return { page, log };
}

interface FakeEngineOptions {
  readonly pages?: readonly LaunchedPage[];
  /** 실행이 이 메시지로 거부된다 */
  readonly fail?: string;
  /** 실행이 이 약속을 기다린 뒤 끝난다 */
  readonly gate?: Promise<void>;
}

/** 가짜 실행기. 실행 기록과 닫은 횟수를 남기고, 브라우저가 닫히면 `closed`가 풀린다 */
function fakeEngine(options: FakeEngineOptions = {}): {
  readonly launcher: Launcher;
  readonly launches: LaunchOptions[];
  readonly closed: Promise<void>;
  readonly closes: () => number;
} {
  const launches: LaunchOptions[] = [];
  const counts = { closes: 0 };
  const closing = Promise.withResolvers<void>();
  const launcher: Launcher = async (launch) => {
    launches.push(launch);
    if (options.gate !== undefined) await options.gate;
    if (options.fail !== undefined) throw new Error(options.fail);
    return {
      pages: () => Promise.resolve(options.pages ?? []),
      close: () => {
        counts.closes += 1;
        closing.resolve();
        return Promise.resolve();
      },
    };
  };
  return {
    launcher,
    launches,
    closed: closing.promise,
    closes: () => counts.closes,
  };
}

/** 임시 상태 폴더. 임시 프로필은 `tmp` 아래, 명명 프로필은 `dataDir` 아래에 간다 */
function harness(): {
  readonly tmp: string;
  readonly dataDir: string;
  readonly dispose: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "web-stagehand-"));
  const tmp = join(root, "tmp");
  const dataDir = join(root, "data");
  mkdirSync(tmp);
  mkdirSync(dataDir);
  return { tmp, dataDir, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("open launches a headless Chrome in a fresh temp profile with the proxy and CHROME_PATH, and close removes the profile", async () => {
  const h = harness();
  try {
    const page = fakePage();
    const engine = fakeEngine({ pages: [page.page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: { CHROME_PATH: "/opt/chrome" },
      logger: SILENT,
    });
    const session = okOf(
      await port.open(
        { headless: true, profile: "ephemeral", proxy: { server: "http://127.0.0.1:8899" } },
        LIVE_SIGNAL,
      ),
    );
    const profile = launchAt(engine.launches, 0).userDataDir;
    expect(launchAt(engine.launches, 0)).toEqual({
      headless: true,
      userDataDir: profile,
      executablePath: "/opt/chrome",
      proxy: { server: "http://127.0.0.1:8899" },
    });
    expect(dirname(profile)).toBe(h.tmp);
    expect(basename(profile).startsWith("stagehand-chrome-")).toBe(true);
    expect(existsSync(profile)).toBe(true);

    expect(await session.close(LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(engine.closes()).toBe(1);
    expect(existsSync(profile)).toBe(false);
  } finally {
    h.dispose();
  }
});

test("without CHROME_PATH the launch leaves the executable to Stagehand, and a named profile stays under the data dir", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [fakePage().page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: false, profile: "named:work" }, LIVE_SIGNAL));
    const profile = join(h.dataDir, "browser-profiles", "work");
    expect(launchAt(engine.launches, 0)).toEqual({ headless: false, userDataDir: profile });
    // Stagehand가 만드는 폴더를 흉내 낸다. 명명 프로필은 닫아도 남아야 한다
    mkdirSync(profile, { recursive: true });

    expect(await session.close(LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(existsSync(profile)).toBe(true);
  } finally {
    h.dispose();
  }
});

test("a profile name outside the allowed shape is refused before a browser starts", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [fakePage().page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    expect(await port.open({ headless: true, profile: "named:../x" }, LIVE_SIGNAL)).toEqual({
      ok: false,
      error: {
        kind: "failed",
        message: "the profile name must be 1 to 32 lowercase letters, digits or '-'",
      },
    });
    expect(engine.launches).toEqual([]);
  } finally {
    h.dispose();
  }
});

test("available is ok when a probe browser starts and closes, and the probe profile is removed", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [fakePage().page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    expect(await port.available(LIVE_SIGNAL)).toEqual({ ok: true });
    expect(engine.launches.map((launch) => launch.headless)).toEqual([true]);
    expect(engine.closes()).toBe(1);
    expect(readdirSync(h.tmp)).toEqual([]);
  } finally {
    h.dispose();
  }
});

test("a missing Chrome makes available not ok with the engine's message, and open unavailable", async () => {
  const h = harness();
  try {
    const message =
      "the browser engine did not start: Chrome installation not found; set CHROME_PATH";
    const engine = fakeEngine({ fail: "Chrome installation not found; set CHROME_PATH" });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    expect(await port.available(LIVE_SIGNAL)).toEqual({ ok: false, detail: message });
    expect(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL)).toEqual({
      ok: false,
      error: { kind: "unavailable", message },
    });
    expect(readdirSync(h.tmp)).toEqual([]);
  } finally {
    h.dispose();
  }
});

test("snapshot returns the page address, title and the engine's tree, map and urls field for field", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [fakePage().page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(okOf(await session.snapshot(LIVE_SIGNAL))).toEqual({
      url: PAGE_URL,
      title: "Shop",
      formattedTree: TREE.formattedTree,
      xpathMap: TREE.xpathMap,
      urlMap: TREE.urlMap,
    });
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("click and fill act on the locator of the XPath, and the other actions pass their exact arguments", async () => {
  const h = harness();
  try {
    const page = fakePage();
    const engine = fakeEngine({ pages: [page.page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(await session.click("/html[1]/body[1]/button[1]", LIVE_SIGNAL)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.fill("/html[1]/body[1]/input[1]", "Ada", LIVE_SIGNAL)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.typeText("hi", LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(await session.pressKey("Enter", LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(await session.scroll(0, 500, LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(await session.selectOption("/html[1]/body[1]/select[1]", ["b"], LIVE_SIGNAL)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.waitMs(250, LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
    expect(okOf(await session.readText(undefined, LIVE_SIGNAL))).toBe("Shop text");
    expect(okOf(await session.readText("/html[1]/body[1]/h1[1]", LIVE_SIGNAL))).toBe("Shop text");
    expect(page.log).toEqual([
      "click /html[1]/body[1]/button[1]",
      "fill /html[1]/body[1]/input[1] Ada",
      "type hi",
      "key Enter",
      "scroll 640 400 0 500",
      "select /html[1]/body[1]/select[1] b",
      "wait 250",
      "innerText /html/body",
      "innerText /html[1]/body[1]/h1[1]",
    ]);
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("a click that moves the top-level page is reported once by navigations", async () => {
  const h = harness();
  try {
    const page = fakePage({ clickMovesTo: "https://shop.example/next" });
    const engine = fakeEngine({ pages: [page.page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    await session.click("/html[1]/body[1]/button[1]", LIVE_SIGNAL);
    expect(session.navigations()).toEqual(["https://shop.example/next"]);
    expect(session.navigations()).toEqual([]);
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("screenshot is a base64 PNG whose size comes from the IHDR chunk", async () => {
  const h = harness();
  try {
    const page = fakePage();
    const engine = fakeEngine({ pages: [page.page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(okOf(await session.screenshot(LIVE_SIGNAL))).toEqual({
      mediaType: "image/png",
      data: Buffer.from(PNG).toString("base64"),
      width: 1280,
      height: 800,
    });
    expect(page.log).toEqual(["screenshot png"]);
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("formAction resolves the form's action against the page address, and is undefined without a form", async () => {
  const h = harness();
  try {
    const withForm = fakePage({ url: "https://shop.example/cart", form: "/pay" });
    const withoutForm = fakePage({ url: "https://shop.example/cart", form: null });
    const port = createStagehandEnginePort({
      launcher: fakeEngine({ pages: [withForm.page] }).launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(okOf(await session.formAction("/html[1]/body[1]/button[1]", LIVE_SIGNAL))).toBe(
      "https://shop.example/pay",
    );
    await session.close(LIVE_SIGNAL);

    const other = createStagehandEnginePort({
      launcher: fakeEngine({ pages: [withoutForm.page] }).launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const plain = okOf(await other.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(okOf(await plain.formAction("/html[1]/body[1]/a[1]", LIVE_SIGNAL))).toBeUndefined();
    await plain.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("a Stagehand error is mapped to failed with only its first line", async () => {
  const h = harness();
  try {
    const page = fakePage({
      click: () =>
        Promise.reject(new Error("element detached\nCall log:\n  waiting for page text")),
    });
    const port = createStagehandEnginePort({
      launcher: fakeEngine({ pages: [page.page] }).launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
    expect(await session.click("/html[1]/body[1]/button[1]", LIVE_SIGNAL)).toEqual({
      ok: false,
      error: { kind: "failed", message: "click: element detached" },
    });
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("an aborted signal maps to aborted before launch, and during a stuck action", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [fakePage().page] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const aborted = new AbortController();
    aborted.abort();
    expect(await port.open({ headless: true, profile: "ephemeral" }, aborted.signal)).toEqual({
      ok: false,
      error: { kind: "aborted" },
    });
    expect(engine.launches).toEqual([]);

    const stuck = Promise.withResolvers<void>();
    const stuckPage = fakePage({ click: () => stuck.promise });
    const live = fakeEngine({ pages: [stuckPage.page] });
    const stuckPort = createStagehandEnginePort({
      launcher: live.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const session = okOf(
      await stuckPort.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL),
    );
    const controller = new AbortController();
    const clicking = session.click("/html[1]/body[1]/button[1]", controller.signal);
    controller.abort();
    expect(await clicking).toEqual({ ok: false, error: { kind: "aborted" } });
    await session.close(LIVE_SIGNAL);
  } finally {
    h.dispose();
  }
});

test("a browser that arrives after its open was aborted is closed and its profile removed", async () => {
  const h = harness();
  try {
    const gate = Promise.withResolvers<void>();
    const engine = fakeEngine({ pages: [fakePage().page], gate: gate.promise });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    const controller = new AbortController();
    const opening = port.open({ headless: true, profile: "ephemeral" }, controller.signal);
    controller.abort();
    expect(await opening).toEqual({ ok: false, error: { kind: "aborted" } });

    gate.resolve();
    await engine.closed;
    // 닫힌 뒤 임시 폴더를 지우는 일은 닫기 다음 순서로 일어난다. 한 번 기다려 그 순서를 지나간다
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(engine.closes()).toBe(1);
    expect(readdirSync(h.tmp)).toEqual([]);
  } finally {
    h.dispose();
  }
});

test("a browser with no page is closed and open reports failed", async () => {
  const h = harness();
  try {
    const engine = fakeEngine({ pages: [] });
    const port = createStagehandEnginePort({
      launcher: engine.launcher,
      tmpDir: h.tmp,
      dataDir: h.dataDir,
      env: {},
      logger: SILENT,
    });
    expect(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL)).toEqual({
      ok: false,
      error: { kind: "failed", message: "open: the browser has no page" },
    });
    expect(engine.closes()).toBe(1);
    expect(readdirSync(h.tmp)).toEqual([]);
  } finally {
    h.dispose();
  }
});

const liveChrome =
  process.env.FRESNEL_LIVE_BROWSER === "1" &&
  (existsSync(process.env.CHROME_PATH ?? "") || existsSync(MAC_CHROME));

test.skipIf(!liveChrome)(
  "live: a data page opens in local Chrome through Stagehand and its snapshot shows the button",
  async () => {
    const h = harness();
    try {
      const port = createStagehandEnginePort({
        tmpDir: h.tmp,
        dataDir: h.dataDir,
        env: process.env,
        logger: SILENT,
      });
      const session = okOf(await port.open({ headless: true, profile: "ephemeral" }, LIVE_SIGNAL));
      try {
        okOf(await session.goto("data:text/html,%3Cbutton%3EPay%20now%3C/button%3E", LIVE_SIGNAL));
        const snapshot = okOf(await session.snapshot(LIVE_SIGNAL));
        expect(snapshot.formattedTree).toContain("button: Pay now");
      } finally {
        expect(await session.close(LIVE_SIGNAL)).toEqual({ ok: true, value: undefined });
      }
      expect(readdirSync(h.tmp)).toEqual([]);
    } finally {
      h.dispose();
    }
  },
  30_000,
);
