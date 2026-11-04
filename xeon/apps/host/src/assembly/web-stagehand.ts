import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  BrowserEnginePort,
  EngineError,
  EngineOpenOptions,
  EngineScreenshot,
  EngineSession,
  EngineSnapshot,
} from "@fresnel/cap-web";
import {
  attempt,
  attemptAsync,
  detach,
  err,
  ok,
  rethrow,
  type Logger,
  type Result,
  type Thrown,
} from "@fresnel/contracts";
import { messageOf } from "../util.ts";

// L2.web.spec §4.10.4a. `BrowserEnginePort`(cap-web이 아는 최소 모양)를 로컬 Chrome을 몬 Stagehand 4.3.0으로 맞춘다.
// Stagehand 타입은 이 파일 밖으로 내보내지 않는다. 아래 `Launched*` 모양은 시험이 가짜로 맞추는 최소 집합이다.
// Stagehand는 `open`이나 `available`을 처음 부를 때 읽는다(동적 import). 브라우징하지 않는 호스트는 시작 시간을 내지 않는다.
// Chrome은 `CHROME_PATH`가 있으면 그 경로로 띄우고, 없으면 Stagehand가 표준 위치에서 찾는다. 찾지 못하면 `unavailable`이고,
// 그러면 후보는 playwright-mcp 폴백으로 넘어간다.
// 엔진 오류 문구는 첫 줄만 싣는다. 뒤쪽 줄(호출 기록)에는 페이지 글이 섞일 수 있다 [가정].

/** 명명 프로필이 사는 폴더(`dataDir` 아래). 명명 프로필의 쿠키와 로그인이 여기 남는다 */
const PROFILES_DIR = "browser-profiles";
/** 명명 프로필 이름. cap-web 스키마(`named:[a-z0-9-]{1,32}`)와 같고, 경로를 만들기 전에 한 번 더 본다 */
const PROFILE_NAME = /^[a-z0-9-]{1,32}$/;
const FAILURE_MAX = 200;
const BODY_XPATH = "/html/body";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 취소 신호가 먼저 울렸다는 표지. 엔진 결과와 섞이지 않게 고유 심볼이다 */
const ABORTED = Symbol("aborted");

/** `localBrowser.launch`에 넘기는 값 가운데 이 어댑터가 쓰는 것 */
export interface LaunchOptions {
  readonly headless: boolean;
  readonly userDataDir: string;
  readonly executablePath?: string;
  readonly proxy?: { readonly server: string };
}

/** Stagehand `Locator`의 쓰는 메서드 */
interface PageLocator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(values: string[]): Promise<unknown>;
  innerText(): Promise<string>;
}

/** Stagehand `Page`의 쓰는 메서드 */
export interface LaunchedPage {
  goto(url: string): Promise<unknown>;
  url(): Promise<string>;
  title(): Promise<string>;
  snapshot(): Promise<{
    readonly formattedTree: string;
    readonly xpathMap: Readonly<Record<string, string>>;
    readonly urlMap: Readonly<Record<string, string>>;
  }>;
  locator(selector: string): PageLocator;
  evaluate(expression: string): Promise<unknown>;
  type(text: string): Promise<void>;
  keyPress(key: string): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { readonly type: "png" }): Promise<Uint8Array>;
}

/** 띄운 브라우저. 페이지 목록과 닫기만 쓴다 */
interface LaunchedBrowser {
  pages(): Promise<readonly LaunchedPage[]>;
  close(): Promise<void>;
}

/** 브라우저를 띄우는 함수. 기본은 Stagehand(`launchStagehand`)다 */
export type Launcher = (options: LaunchOptions) => Promise<LaunchedBrowser>;

export interface StagehandEngineDeps {
  /** 시험 주입: 생략하면 Stagehand다 */
  readonly launcher?: Launcher;
  /** 임시 프로필을 만드는 폴더(`os.dirs.tmp`) */
  readonly tmpDir: string;
  /** 명명 프로필의 상위 폴더(`os.dirs.data`) */
  readonly dataDir: string;
  /** 프로세스 환경. `CHROME_PATH`만 읽는다 */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Pick<Logger, "warn">;
}

interface Profile {
  readonly dir: string;
  /** 임시 프로필은 닫을 때 지운다. 명명 프로필은 남긴다 */
  readonly removeOnClose: boolean;
}

interface Started {
  readonly browser: LaunchedBrowser;
  readonly page: LaunchedPage;
  readonly profile: Profile;
}

/**
 * 기본 실행기. Stagehand를 여기서 처음 읽고 로컬 Chrome을 띄운다. 모델은 넘기지 않는다: 동작은 XPath로 하고 모델 호출은 없다.
 */
async function launchStagehand(options: LaunchOptions): Promise<LaunchedBrowser> {
  const { Stagehand, localBrowser } = await import("@browserbasehq/stagehand");
  const browser = await localBrowser.launch({
    headless: options.headless,
    userDataDir: options.userDataDir,
    ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
  });
  // `browser.context`는 `Stagehand.create` 전에는 동작하지 않는다. 정보 로그는 표준 오류에 그대로 나가므로 오류만 남긴다
  const created = await attemptAsync(() =>
    Stagehand.create({ browser, logging: { level: "error" } }),
  );
  if (!created.ok) {
    await browser.close();
    rethrow(created.error.cause);
  }
  return {
    pages: () => browser.context.pages(),
    close: () => browser.close(),
  };
}

export function createStagehandEnginePort(deps: StagehandEngineDeps): BrowserEnginePort {
  return {
    async available(signal) {
      // 확인은 띄워 보는 것이다. Chrome 탐색은 Stagehand 안에 있어서 따로 셀 수 없다
      const started = await startEngine(deps, { headless: true, profile: "ephemeral" }, signal);
      if (!started.ok) return { ok: false, detail: failureText(started.error) };
      const shut = await shutDown(deps, started.value.browser, started.value.profile);
      return shut.ok ? { ok: true } : { ok: false, detail: failureText(shut.error) };
    },
    async open(options, signal) {
      const started = await startEngine(deps, options, signal);
      return started.ok ? ok(sessionOf(deps, started.value)) : err(started.error);
    },
  };
}

/** 프로필을 정하고 브라우저를 띄운 뒤 첫 페이지를 잡는다. 실패하면 남은 것을 치운다 */
async function startEngine(
  deps: StagehandEngineDeps,
  options: EngineOpenOptions,
  signal: AbortSignal,
): Promise<Result<Started, EngineError>> {
  if (signal.aborted) return err({ kind: "aborted" });
  const profile = profileOf(deps, options.profile);
  if (!profile.ok) return err(profile.error);
  const chromePath = deps.env.CHROME_PATH;
  const launchOptions: LaunchOptions = {
    headless: options.headless,
    userDataDir: profile.value.dir,
    ...(chromePath === undefined || chromePath === "" ? {} : { executablePath: chromePath }),
    ...(options.proxy === undefined ? {} : { proxy: { server: options.proxy.server } }),
  };
  const launch = deps.launcher ?? launchStagehand;
  const launching = attemptAsync(() => launch(launchOptions));
  const settled = await raced(launching, signal);
  if (settled === ABORTED) {
    // 취소 뒤에 끝난 실행은 기다리지 않고 닫는다. 닫다 실패하면 기록만 남긴다
    detach(settleLate(launching, deps, profile.value), (cause) =>
      deps.logger.warn("web.browser_engine_late_failed", { reason: messageOf(cause) }),
    );
    return err({ kind: "aborted" });
  }
  if (!settled.ok) {
    discard(deps, profile.value);
    return err({
      kind: "unavailable",
      message: `the browser engine did not start: ${firstLine(settled.error.cause)}`,
    });
  }
  const browser = settled.value;
  const page = await firstPage(browser);
  if (!page.ok) {
    await closeQuietly(deps, browser, profile.value);
    return err(page.error);
  }
  return ok({ browser, page: page.value, profile: profile.value });
}

/** 취소 뒤에 끝난 실행을 닫는다. 실행이 실패했으면 프로필만 치운다 */
async function settleLate(
  launching: Promise<Result<LaunchedBrowser, Thrown>>,
  deps: StagehandEngineDeps,
  profile: Profile,
): Promise<void> {
  const done = await launching;
  if (done.ok) await closeQuietly(deps, done.value, profile);
  else discard(deps, profile);
}

function profileOf(
  deps: StagehandEngineDeps,
  profile: EngineOpenOptions["profile"],
): Result<Profile, EngineError> {
  if (profile === "ephemeral") {
    const made = attempt(() => mkdtempSync(join(deps.tmpDir, "stagehand-chrome-")));
    return made.ok
      ? ok({ dir: made.value, removeOnClose: true })
      : err({ kind: "failed", message: "the profile directory cannot be made" });
  }
  const name = profile.slice("named:".length);
  if (!PROFILE_NAME.test(name)) {
    return err({
      kind: "failed",
      message: "the profile name must be 1 to 32 lowercase letters, digits or '-'",
    });
  }
  return ok({ dir: join(deps.dataDir, PROFILES_DIR, name), removeOnClose: false });
}

async function firstPage(browser: LaunchedBrowser): Promise<Result<LaunchedPage, EngineError>> {
  const pages = await attemptAsync(() => browser.pages());
  if (!pages.ok) return err({ kind: "failed", message: `open: ${firstLine(pages.error.cause)}` });
  const [page] = pages.value;
  return page === undefined
    ? err({ kind: "failed", message: "open: the browser has no page" })
    : ok(page);
}

function sessionOf(deps: StagehandEngineDeps, started: Started): EngineSession {
  const { browser, page, profile } = started;
  // 최상위 문서 이동은 동작 앞뒤의 주소를 비교해 모은다. `navigations()`가 비운다
  const moved: string[] = [];
  let closing: Promise<Result<void, EngineError>> | undefined;

  const acting = (
    what: string,
    signal: AbortSignal,
    work: () => PromiseLike<unknown>,
  ): Promise<Result<void, EngineError>> =>
    engineCall(what, signal, async () => {
      const before = await page.url();
      await work();
      const after = await page.url();
      if (after !== before) moved.push(after);
    });

  return {
    goto: (url, signal) => acting("goto", signal, () => page.goto(url)),
    snapshot: (signal) => engineCall("snapshot", signal, () => snapshotOf(page)),
    click: (xpath, signal) => acting("click", signal, () => page.locator(xpath).click()),
    fill: (xpath, text, signal) => acting("fill", signal, () => page.locator(xpath).fill(text)),
    typeText: (text, signal) => acting("type", signal, () => page.type(text)),
    pressKey: (key, signal) => acting("key", signal, () => page.keyPress(key)),
    scroll: (deltaX, deltaY, signal) =>
      acting("scroll", signal, () => scrollBy(page, deltaX, deltaY)),
    selectOption: (xpath, values, signal) =>
      acting("select", signal, () => page.locator(xpath).selectOption([...values])),
    waitMs: (ms, signal) => acting("wait", signal, () => page.waitForTimeout(ms)),
    screenshot: (signal) => engineCall("screenshot", signal, () => screenshotOf(page)),
    readText: (xpath, signal) =>
      engineCall("read", signal, () => page.locator(xpath ?? BODY_XPATH).innerText()),
    formAction: (xpath, signal) => engineCall("form", signal, () => formActionOf(page, xpath)),
    navigations: () => moved.splice(0),
    // 닫기는 취소하지 않는다: 중간에 끊으면 Chrome 프로세스가 남는다
    close: () => {
      closing ??= shutDown(deps, browser, profile);
      return closing;
    },
  };
}

async function snapshotOf(page: LaunchedPage): Promise<EngineSnapshot> {
  const url = await page.url();
  const title = await page.title();
  const tree = await page.snapshot();
  return {
    url,
    title,
    formattedTree: tree.formattedTree,
    xpathMap: tree.xpathMap,
    urlMap: tree.urlMap,
  };
}

async function screenshotOf(page: LaunchedPage): Promise<EngineScreenshot> {
  const bytes = await page.screenshot({ type: "png" });
  const size = pngSizeOf(bytes);
  if (size === undefined) throw new Error("the screenshot is not a PNG");
  return {
    mediaType: "image/png",
    data: Buffer.from(bytes).toString("base64"),
    width: size.width,
    height: size.height,
  };
}

/** PNG의 첫 청크(IHDR)에서 너비와 높이를 읽는다. 시그니처가 없거나 짧으면 undefined */
function pngSizeOf(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (bytes.byteLength < 24) return undefined;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return undefined;
  if (new TextDecoder().decode(bytes.subarray(12, 16)) !== "IHDR") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function scrollBy(page: LaunchedPage, deltaX: number, deltaY: number): Promise<void> {
  // 휠은 커서 자리에 간다. 뷰포트 가운데에 두어 고정 머리글 위에서 빗나가지 않게 한다 [가정]
  const x = await page.evaluate("Math.round(innerWidth / 2)");
  const y = await page.evaluate("Math.round(innerHeight / 2)");
  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error("the page has no viewport size");
  }
  await page.scroll(x, y, deltaX, deltaY);
}

/**
 * 요소가 속한 폼의 action 주소. XPath는 엔진 스냅샷의 값이라 JSON 문자열로 넣는다. action은 폼의 속성을 프로토타입으로 읽는다:
 * 폼 안의 `name="action"` 입력이 `form.action`을 가리면 주소가 사라져 교차 출처 확인을 건너뛰게 된다.
 */
function formScriptOf(xpath: string): string {
  return `(() => { const el = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; const form = el instanceof HTMLElement ? (el.form ?? el.closest("form")) : null; return form === null ? null : (Element.prototype.getAttribute.call(form, "action") ?? ""); })()`;
}

async function formActionOf(page: LaunchedPage, xpath: string): Promise<string | undefined> {
  const raw = await page.evaluate(formScriptOf(xpath));
  if (typeof raw !== "string") return undefined;
  const base = await page.url();
  const resolved = attempt(() => new URL(raw, base));
  return resolved.ok ? resolved.value.href : undefined;
}

/** 엔진 호출 하나. 취소 신호가 먼저 울리면 `aborted`, 던지면 `failed`다 */
async function engineCall<T>(
  what: string,
  signal: AbortSignal,
  work: () => PromiseLike<T>,
): Promise<Result<T, EngineError>> {
  if (signal.aborted) return err({ kind: "aborted" });
  const settled = await raced(attemptAsync(work), signal);
  if (settled === ABORTED) return err({ kind: "aborted" });
  if (!settled.ok)
    return err({ kind: "failed", message: `${what}: ${firstLine(settled.error.cause)}` });
  return ok(settled.value);
}

/**
 * `work`가 끝나면 그 값을, 취소 신호가 먼저 울리면 `ABORTED`를 준다. 기다리던 일은 멈추지 못하고 결과만 버린다.
 * 귀(listener)는 기다림이 끝나면 떼어 취소 신호에 쌓이지 않게 한다.
 */
function raced<T>(work: Promise<T>, signal: AbortSignal): Promise<Awaited<T> | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  const stop = Promise.withResolvers<typeof ABORTED>();
  const onAbort = (): void => stop.resolve(ABORTED);
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([work, stop.promise]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

/** 브라우저를 닫고 임시 프로필을 지운다. 닫기 실패는 `failed`로 돌려준다 */
async function shutDown(
  deps: StagehandEngineDeps,
  browser: LaunchedBrowser,
  profile: Profile,
): Promise<Result<void, EngineError>> {
  const closed = await attemptAsync(() => browser.close());
  discard(deps, profile);
  return closed.ok
    ? ok(undefined)
    : err({ kind: "failed", message: `close: ${firstLine(closed.error.cause)}` });
}

async function closeQuietly(
  deps: StagehandEngineDeps,
  browser: LaunchedBrowser,
  profile: Profile,
): Promise<void> {
  const shut = await shutDown(deps, browser, profile);
  if (!shut.ok)
    deps.logger.warn("web.browser_engine_close_failed", { reason: failureText(shut.error) });
}

function discard(deps: StagehandEngineDeps, profile: Profile): void {
  if (!profile.removeOnClose) return;
  const removed = attempt(() => rmSync(profile.dir, { recursive: true, force: true }));
  if (!removed.ok) {
    deps.logger.warn("web.browser_profile_remove_failed", {
      reason: messageOf(removed.error.cause),
    });
  }
}

/** 오류 문구. 취소는 문구가 없으니 종류를 말한다 */
function failureText(error: EngineError): string {
  return error.kind === "aborted" ? "the check was cancelled" : error.message;
}

/** 던져진 값의 첫 줄만, 상한까지 */
function firstLine(cause: unknown): string {
  const line = messageOf(cause).split("\n")[0] ?? "";
  return line.slice(0, FAILURE_MAX);
}
