import { afterEach, describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import { CapabilityError, type CallerInfo, type CallOptions } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { BrowseCandidate } from "../src/ports/providers.ts";
import type {
  BrowseConfirmError,
  BrowseConfirmPort,
  BrowseConfirmRequest,
} from "../src/ports/confirm.ts";
import {
  browseCandidate,
  fakeBrowseProvider,
  type FakeBrowseProvider,
  type FakePage,
} from "../src/testing/fake-browser.ts";
import { fakeCatalog, fakeManifest } from "../src/testing/fake-providers.ts";
import { threadIdOf } from "./support/ids.ts";
import { releaseStores } from "./support/store.ts";
import {
  makeWebWorld,
  PUBLIC_IP,
  type WebWorld,
  type WebWorldOptions,
} from "./support/web-world.ts";

// `web.browse` 서비스(L2.web.spec §4.10). 세션 수명, 이동 정책, 기본 비활성 동작, 사람 확인, 세션 상한, 선택 순서를 본다.
// provider는 가짜 브라우저(`testing/fake-browser.ts`)이고, 시험은 provider가 받은 동작 기록과 돌려준 값으로 판정한다.

afterEach(releaseStores);

const THREAD: ThreadId = threadIdOf(1);
const OTHER: ThreadId = threadIdOf(2);
const EXAMPLE = "https://example.com/a";
const SHOP = "https://example.com/shop";
const PAGES: Readonly<Record<string, FakePage>> = {
  [EXAMPLE]: { url: EXAMPLE, title: "Example A" },
  [SHOP]: {
    url: SHOP,
    title: "Shop",
    elements: {
      e1: { role: "button", name: "Pay now" },
      e2: { role: "button", name: "Next" },
      e3: { role: "button", name: "Go", formAction: "https://evil.example/collect" },
    },
  },
};
function callAs(caller: CallerInfo, threadId: ThreadId = THREAD): CallOptions {
  return { requestId: `req-${caller.kind}`, context: { threadId, caller } };
}

function hostCall(threadId: ThreadId = THREAD): CallOptions {
  return callAs({ kind: "host" }, threadId);
}

/** 모델 도구 경로 호출. `afterUntrusted`는 이번 턴에 외부 내용을 이미 읽었는가 */
function modelCall(afterUntrusted: boolean): CallOptions {
  return callAs({ kind: "model", agent: "main", afterUntrusted });
}

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

function worldOf(
  candidates: readonly BrowseCandidate[],
  options: Pick<WebWorldOptions, "settings" | "hosts" | "browseConfirm"> = {},
): Promise<WebWorld> {
  return makeWebWorld({ ...options, catalog: fakeCatalog([], [], candidates) });
}

interface Confirm {
  readonly port: BrowseConfirmPort;
  readonly requests: BrowseConfirmRequest[];
}

/** 같은 답을 하고 받은 요청을 기록하는 사람 확인 대역 */
function confirmWith(answer: Result<"allow" | "deny", BrowseConfirmError>): Confirm {
  const requests: BrowseConfirmRequest[] = [];
  return {
    requests,
    port: {
      confirm(request) {
        requests.push(request);
        return Promise.resolve(answer);
      },
    },
  };
}

const ALLOW = (): Result<"allow" | "deny", BrowseConfirmError> => ok("allow");
const DENY = (): Result<"allow" | "deny", BrowseConfirmError> => ok("deny");
const UNAVAILABLE = (): Result<"allow" | "deny", BrowseConfirmError> =>
  err({ kind: "unavailable", message: "the approval channel is down" });

/** provider가 `open`에서 던지는 능력 오류 */
function failure(code: string, retryable: boolean): CapabilityError {
  return new CapabilityError({
    capability: "web.browse",
    method: "open",
    code,
    message: `${code} from the browser`,
    retryable,
  });
}

/** 신고 대상 버튼("Pay now")을 누르고, 실패 오류와 provider 기록과 확인 요청 기록을 돌려준다 */
async function clickPayWith(
  answer: Result<"allow" | "deny", BrowseConfirmError>,
): Promise<{ caught: CapabilityError; local: FakeBrowseProvider; confirm: Confirm }> {
  const local = fakeBrowseProvider("local-browser", { pages: PAGES });
  const confirm = confirmWith(answer);
  const world = await worldOf([browseCandidate(local, "builtin")], {
    browseConfirm: confirm.port,
  });
  const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
  const caught = await rejection(
    world.browse.act({ sessionId, action: "click", target: { ref: "e1" } }, hostCall()),
  );
  return { caught, local, confirm };
}

describe("web.browse open", () => {
  test("open without a url returns a blank session from the first provider", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const out = await world.browse.open({}, hostCall());
    expect(out.sessionId).toMatch(/^wbr_/);
    expect(out.page).toEqual({ url: "about:blank", title: "", tabId: "t1" });
    expect(out.meta).toMatchObject({
      provider: "local-browser",
      selectedBy: "auto",
      fallbacks: [],
      cache: "bypass",
    });
    expect(local.opened).toEqual([{ profile: "ephemeral", headless: true, allowedOrigins: [] }]);
    expect(local.log).toEqual([]);
  });

  test("open with a url on an allowed host navigates there and returns the page title", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const out = await world.browse.open({ url: EXAMPLE }, hostCall());
    expect(local.log).toEqual([`navigate:${EXAMPLE}`]);
    expect(out.page).toEqual({ url: EXAMPLE, title: "Example A", tabId: "t1" });
  });

  test("open with a url on a denied domain is refused before any provider opens", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { policy: { deny: ["blocked.example"] } },
      hosts: { "blocked.example": [PUBLIC_IP] },
    });
    const caught = await rejection(
      world.browse.open({ url: "https://blocked.example/" }, hostCall()),
    );
    expect(caught.data.code).toBe("denied");
    expect(caught.data.detail).toEqual({ reason: "domain_denied", host: "blocked.example" });
    expect(local.opened).toEqual([]);
  });

  test("open with a metadata or private address is refused before any provider opens", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")], {
      hosts: { "intranet.example": ["10.0.0.5"] },
    });
    const metadata = await rejection(
      world.browse.open({ url: "http://169.254.169.254/latest/meta-data" }, hostCall()),
    );
    expect(metadata.data.code).toBe("denied");
    expect(metadata.data.detail).toEqual({ reason: "metadata_address", host: "169.254.169.254" });
    const intranet = await rejection(
      world.browse.open({ url: "https://intranet.example/" }, hostCall()),
    );
    expect(intranet.data.code).toBe("denied");
    expect(intranet.data.detail).toEqual({
      reason: "private_network_disabled",
      host: "intranet.example",
      address: "10.0.0.5",
    });
    expect(local.opened).toEqual([]);
  });

  test("a redirect during open closes the session and resets the page", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    local.redirectNextTo("http://169.254.169.254/");
    const caught = await rejection(world.browse.open({ url: EXAMPLE }, hostCall()));
    expect(caught.data.code).toBe("denied");
    expect(caught.data.detail).toEqual({
      reason: "navigation_denied",
      cause: { reason: "metadata_address", host: "169.254.169.254" },
    });
    expect(local.log).toEqual([`navigate:${EXAMPLE}`, "navigate:about:blank"]);
    expect(local.closed()).toBe(1);
    expect(world.browseControl.openCount()).toBe(0);
  });
});

describe("web.browse provider selection", () => {
  test("auto tries the builtin provider before a plugin, whatever the candidate order", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    const world = await worldOf([
      browseCandidate(plugin, "plugin"),
      browseCandidate(local, "builtin"),
    ]);
    const out = await world.browse.open({}, hostCall());
    expect(out.meta.provider).toBe("local-browser");
    expect(plugin.opened).toEqual([]);
  });

  test("the user's browse order can put a plugin ahead of the builtin provider", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    const world = await worldOf(
      [browseCandidate(local, "builtin"), browseCandidate(plugin, "plugin")],
      { settings: { browse: { order: ["plugin:web-x"] } } },
    );
    const out = await world.browse.open({}, hostCall());
    expect(out.meta).toMatchObject({ provider: "plugin:web-x", selectedBy: "auto" });
    expect(local.opened).toEqual([]);
  });

  test("a probe failure falls back to the next auto candidate and records it", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.setAvailability({ ok: false, reason: "unreachable" });
    const world = await worldOf([
      browseCandidate(local, "builtin"),
      browseCandidate(plugin, "plugin"),
    ]);
    const out = await world.browse.open({}, hostCall());
    expect(out.meta.provider).toBe("plugin:web-x");
    expect(out.meta.fallbacks).toEqual([
      { provider: "local-browser", stage: "probe", reason: "unreachable" },
    ]);
    expect(local.opened).toEqual([]);
    expect(plugin.opened.length).toBe(1);
  });

  test("an open error with a fallback code moves on in auto and records the call stage", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.failOpenWith(failure("unavailable", true));
    const world = await worldOf([
      browseCandidate(local, "builtin"),
      browseCandidate(plugin, "plugin"),
    ]);
    const out = await world.browse.open({}, hostCall());
    expect(out.meta.provider).toBe("plugin:web-x");
    expect(out.meta.fallbacks).toEqual([
      { provider: "local-browser", stage: "call", reason: "unavailable" },
    ]);
  });

  test("an open error outside the fallback codes is returned at once", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.failOpenWith(failure("invalid_input", false));
    const world = await worldOf([
      browseCandidate(local, "builtin"),
      browseCandidate(plugin, "plugin"),
    ]);
    const caught = await rejection(world.browse.open({}, hostCall()));
    expect(caught.data.code).toBe("invalid_input");
    expect(caught.data.provider).toBe("local-browser");
    expect(plugin.opened).toEqual([]);
  });

  test("an explicit provider argument does not fall back when its probe fails", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.setAvailability({ ok: false, reason: "unreachable" });
    const world = await worldOf([
      browseCandidate(local, "builtin"),
      browseCandidate(plugin, "plugin"),
    ]);
    const caught = await rejection(world.browse.open({ provider: "local-browser" }, hostCall()));
    expect(caught.data.code).toBe("unavailable");
    expect(caught.data.provider).toBe("local-browser");
    expect(caught.data.retryable).toBe(true);
    expect(caught.data.detail).toEqual({ reason: "unreachable" });
    expect(plugin.opened).toEqual([]);
  });

  test("an explicit provider argument does not fall back when its open fails", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.failOpenWith(failure("unavailable", true));
    const world = await worldOf([
      browseCandidate(local, "builtin"),
      browseCandidate(plugin, "plugin"),
    ]);
    const caught = await rejection(world.browse.open({ provider: "local-browser" }, hostCall()));
    expect(caught.data.code).toBe("unavailable");
    expect(caught.data.provider).toBe("local-browser");
    expect(plugin.opened).toEqual([]);
  });

  test("a provider named in the setting does not fall back when its open fails", async () => {
    const local = fakeBrowseProvider("local-browser");
    const plugin = fakeBrowseProvider("plugin:web-x");
    local.failOpenWith(failure("unavailable", true));
    const world = await worldOf(
      [browseCandidate(local, "builtin"), browseCandidate(plugin, "plugin")],
      { settings: { browse: { provider: "local-browser" } } },
    );
    const caught = await rejection(world.browse.open({}, hostCall()));
    expect(caught.data.code).toBe("unavailable");
    expect(caught.data.provider).toBe("local-browser");
    expect(plugin.opened).toEqual([]);
  });

  test("with no registered browse provider the error reason is no_provider", async () => {
    const world = await worldOf([]);
    const caught = await rejection(world.browse.open({}, hostCall()));
    expect(caught.data.code).toBe("unavailable");
    expect(caught.data.detail).toEqual({ reason: "no_provider", fallbacks: [] });
  });

  test("an unknown explicit provider, by call or by setting, is unknown_provider", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { provider: "ghost" } },
    });
    const bySetting = await rejection(world.browse.open({}, hostCall()));
    expect(bySetting.data.detail).toEqual({ reason: "unknown_provider", fallbacks: [] });
    const byCall = await rejection(world.browse.open({ provider: "ghost" }, hostCall()));
    expect(byCall.data.detail).toEqual({ reason: "unknown_provider", fallbacks: [] });
    expect(local.opened).toEqual([]);
  });
});

describe("web.browse session limits and thread scope", () => {
  test("maxSessions caps the sessions one thread holds, and another thread is not limited", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { maxSessions: 1 } },
    });
    await world.browse.open({}, hostCall(THREAD));
    const second = await rejection(world.browse.open({}, hostCall(THREAD)));
    expect(second.data.code).toBe("session_budget");
    expect(second.data.detail).toEqual({ reason: "sessions" });
    const other = await world.browse.open({}, hostCall(OTHER));
    expect(other.sessionId).toMatch(/^wbr_/);
    expect(world.browseControl.openCount()).toBe(2);
  });

  test("a session of another thread is not found and is not closed by that thread", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({}, hostCall(THREAD));
    const acted = await rejection(world.browse.act({ sessionId, action: "wait" }, hostCall(OTHER)));
    expect(acted.data.code).toBe("not_found");
    const closed = await world.browse.close({ sessionId }, hostCall(OTHER));
    expect(closed).toEqual({ closed: false, stats: { actions: 0, seconds: 0, usd: 0 } });
    expect(local.closed()).toBe(0);
    expect(local.log).toEqual([]);
    const own = await world.browse.act({ sessionId, action: "wait" }, hostCall(THREAD));
    expect(own.page.url).toBe("about:blank");
    expect(local.log).toEqual(["wait"]);
  });

  test("closeThread closes that thread's sessions only", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")]);
    await world.browse.open({}, hostCall(THREAD));
    await world.browse.open({}, hostCall(THREAD));
    const kept = await world.browse.open({}, hostCall(OTHER));
    await world.browseControl.closeThread(THREAD);
    expect(local.closed()).toBe(2);
    expect(world.browseControl.openCount()).toBe(1);
    const stillOpen = await world.browse.close({ sessionId: kept.sessionId }, hostCall(OTHER));
    expect(stillOpen.closed).toBe(true);
  });

  test("close returns the session stats: actions, seconds and usd", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({ url: EXAMPLE }, hostCall());
    await world.browse.act({ sessionId, action: "wait" }, hostCall());
    world.clock.advance(90_000);
    const closed = await world.browse.close({ sessionId }, hostCall());
    expect(closed).toEqual({ closed: true, stats: { actions: 2, seconds: 90, usd: 0 } });
    expect(local.closed()).toBe(1);
  });

  test("maxActions: the action after the limit is session_budget and the session is closed", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { maxActions: 2 } },
    });
    const { sessionId } = await world.browse.open({}, hostCall());
    await world.browse.act({ sessionId, action: "wait" }, hostCall());
    await world.browse.act({ sessionId, action: "wait" }, hostCall());
    const caught = await rejection(world.browse.act({ sessionId, action: "wait" }, hostCall()));
    expect(caught.data.code).toBe("session_budget");
    expect(caught.data.detail).toEqual({ reason: "actions" });
    expect(local.log).toEqual(["wait", "wait"]);
    expect(local.closed()).toBe(1);
    const closed = await world.browse.close({ sessionId }, hostCall());
    expect(closed).toEqual({ closed: false, stats: { actions: 0, seconds: 0, usd: 0 } });
  });

  test("maxMinutes: an action after the time limit is session_budget and the session is closed", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { maxMinutes: 1 } },
    });
    const { sessionId } = await world.browse.open({}, hostCall());
    world.clock.advance(59_000);
    await world.browse.act({ sessionId, action: "wait" }, hostCall());
    world.clock.advance(1_000);
    const caught = await rejection(world.browse.act({ sessionId, action: "wait" }, hostCall()));
    expect(caught.data.code).toBe("session_budget");
    expect(caught.data.detail).toEqual({ reason: "time" });
    expect(local.closed()).toBe(1);
  });

  test("maxUsd: an action after the cost limit is session_budget and the session is closed", async () => {
    const local = fakeBrowseProvider("local-browser", {
      pages: PAGES,
      manifest: fakeManifest("local-browser", {
        services: ["browse"],
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://local-browser.example/pricing",
          currency: "USD",
          units: { browse_action: 0.01 },
        },
      }),
    });
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { maxUsd: 0.02 } },
    });
    const { sessionId } = await world.browse.open({ url: EXAMPLE }, hostCall());
    await world.browse.act({ sessionId, action: "wait" }, hostCall());
    const caught = await rejection(world.browse.act({ sessionId, action: "wait" }, hostCall()));
    expect(caught.data.code).toBe("session_budget");
    expect(caught.data.detail).toEqual({ reason: "cost" });
    expect(local.log).toEqual([`navigate:${EXAMPLE}`, "wait"]);
  });

  test("the price of each action comes from the manifest and close totals it", async () => {
    const local = fakeBrowseProvider("local-browser", {
      pages: PAGES,
      manifest: fakeManifest("local-browser", {
        services: ["browse"],
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://local-browser.example/pricing",
          currency: "USD",
          units: { browse_action: 0.01 },
        },
      }),
    });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const opened = await world.browse.open({ url: EXAMPLE }, hostCall());
    expect(opened.meta.cost).toEqual({
      usd: 0.01,
      basis: "estimated",
      units: [{ name: "browse_action", count: 1 }],
      pricingAsOf: "2026-10-20",
    });
    const acted = await world.browse.act(
      { sessionId: opened.sessionId, action: "wait" },
      hostCall(),
    );
    expect(acted.meta.cost).toEqual({
      usd: 0.01,
      basis: "estimated",
      units: [{ name: "browse_action", count: 1 }],
      pricingAsOf: "2026-10-20",
    });
    const closed = await world.browse.close({ sessionId: opened.sessionId }, hostCall());
    expect(closed.stats).toEqual({ actions: 2, seconds: 0, usd: 0.02 });
  });
});

describe("web.browse actions", () => {
  test("upload and evaluate are refused by default with action_disabled", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({}, hostCall());
    const evaluated = await rejection(
      world.browse.act({ sessionId, action: "evaluate" }, hostCall()),
    );
    expect(evaluated.data.code).toBe("action_disabled");
    const uploaded = await rejection(world.browse.act({ sessionId, action: "upload" }, hostCall()));
    expect(uploaded.data.code).toBe("action_disabled");
    expect(local.log).toEqual([]);
  });

  test("evaluate and upload run once the settings allow them", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { allowJavascriptExec: true, allowFileUpload: true } },
    });
    const { sessionId } = await world.browse.open({}, hostCall());
    await world.browse.act({ sessionId, action: "evaluate" }, hostCall());
    await world.browse.act({ sessionId, action: "upload" }, hostCall());
    expect(local.log).toEqual(["evaluate", "upload"]);
  });

  test("a navigate action to a denied address is refused before the provider sees it", async () => {
    const local = fakeBrowseProvider("local-browser");
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({}, hostCall());
    const caught = await rejection(
      world.browse.act(
        { sessionId, action: "navigate", url: "http://169.254.169.254/latest/meta-data" },
        hostCall(),
      ),
    );
    expect(caught.data.code).toBe("denied");
    expect(caught.data.detail).toEqual({ reason: "metadata_address", host: "169.254.169.254" });
    expect(local.log).toEqual([]);
  });

  test("a redirect into a denied address during an action resets the page to about:blank", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({ url: EXAMPLE }, hostCall());
    local.redirectNextTo("http://169.254.169.254/");
    const caught = await rejection(world.browse.act({ sessionId, action: "click" }, hostCall()));
    expect(caught.data.code).toBe("denied");
    expect(caught.data.detail).toEqual({
      reason: "navigation_denied",
      cause: { reason: "metadata_address", host: "169.254.169.254" },
    });
    expect(local.log).toEqual([`navigate:${EXAMPLE}`, "click", "navigate:about:blank"]);
  });
});

describe("web.browse human confirmation", () => {
  test("a sensitive click without a confirm port is refused", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
    const caught = await rejection(
      world.browse.act({ sessionId, action: "click", target: { ref: "e1" } }, hostCall()),
    );
    expect(caught.data.code).toBe("confirmation_denied");
    expect(caught.data.detail).toEqual({ reason: "sensitive_click" });
    expect(local.log).toEqual([`navigate:${SHOP}`]);
  });

  test("a sensitive click the user allows runs, and the port sees the request", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const confirm = confirmWith(ALLOW());
    const world = await worldOf([browseCandidate(local, "builtin")], {
      browseConfirm: confirm.port,
    });
    const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
    const acted = await world.browse.act(
      { sessionId, action: "click", target: { ref: "e1" } },
      hostCall(),
    );
    expect(acted.page.url).toBe(SHOP);
    expect(local.log).toEqual([`navigate:${SHOP}`, "click"]);
    expect(confirm.requests).toEqual([
      {
        threadId: THREAD,
        sessionId,
        reason: "sensitive_click",
        url: SHOP,
        role: "button",
        name: "Pay now",
        requestKey: `act:${sessionId}:1`,
      },
    ]);
  });

  test("a sensitive click the user denies is refused", async () => {
    const { caught, local, confirm } = await clickPayWith(DENY());
    expect(caught.data.code).toBe("confirmation_denied");
    expect(caught.data.detail).toEqual({ reason: "sensitive_click" });
    expect(local.log).toEqual([`navigate:${SHOP}`]);
    expect(confirm.requests.map((request) => request.reason)).toEqual(["sensitive_click"]);
  });

  test("a sensitive click is refused when the approval channel is unavailable", async () => {
    const { caught, local, confirm } = await clickPayWith(UNAVAILABLE());
    expect(caught.data.code).toBe("confirmation_denied");
    expect(local.log).toEqual([`navigate:${SHOP}`]);
    expect(confirm.requests.map((request) => request.reason)).toEqual(["sensitive_click"]);
  });

  test("a non-sensitive click needs no confirmation", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const confirm = confirmWith(DENY());
    const world = await worldOf([browseCandidate(local, "builtin")], {
      browseConfirm: confirm.port,
    });
    const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
    await world.browse.act({ sessionId, action: "click", target: { ref: "e2" } }, hostCall());
    expect(local.log).toEqual([`navigate:${SHOP}`, "click"]);
    expect(confirm.requests).toEqual([]);
  });

  test("a form that submits to another origin needs confirmation with reason cross_origin_form", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const world = await worldOf([browseCandidate(local, "builtin")]);
    const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
    const caught = await rejection(
      world.browse.act({ sessionId, action: "click", target: { ref: "e3" } }, hostCall()),
    );
    expect(caught.data.code).toBe("confirmation_denied");
    expect(caught.data.detail).toEqual({ reason: "cross_origin_form" });
    expect(local.log).toEqual([`navigate:${SHOP}`]);
  });

  test("fill after untrusted content asks with after_untrusted_input, and not otherwise", async () => {
    const local = fakeBrowseProvider("local-browser", { pages: PAGES });
    const confirm = confirmWith(ALLOW());
    const world = await worldOf([browseCandidate(local, "builtin")], {
      browseConfirm: confirm.port,
    });
    const { sessionId } = await world.browse.open({ url: SHOP }, hostCall());
    await world.browse.act({ sessionId, action: "fill", text: "a@example.com" }, modelCall(false));
    expect(confirm.requests).toEqual([]);
    await world.browse.act({ sessionId, action: "fill", text: "a@example.com" }, modelCall(true));
    expect(confirm.requests.map((request) => request.reason)).toEqual(["after_untrusted_input"]);
    expect(local.log).toEqual([`navigate:${SHOP}`, "fill", "fill"]);
  });
});

describe("web.browse named profiles", () => {
  test("a named profile is refused with action_disabled unless the setting allows it", async () => {
    const local = fakeBrowseProvider("local-browser");
    const confirm = confirmWith(ALLOW());
    const world = await worldOf([browseCandidate(local, "builtin")], {
      browseConfirm: confirm.port,
    });
    const caught = await rejection(world.browse.open({ profile: "named:work" }, hostCall()));
    expect(caught.data.code).toBe("action_disabled");
    expect(local.opened).toEqual([]);
    expect(confirm.requests).toEqual([]);
  });

  test("with the setting on, a named profile opens only after the user allows it", async () => {
    const local = fakeBrowseProvider("local-browser");
    const allowed = confirmWith(ALLOW());
    const allowedWorld = await worldOf([browseCandidate(local, "builtin")], {
      settings: { browse: { allowNamedProfiles: true } },
      browseConfirm: allowed.port,
    });
    const out = await allowedWorld.browse.open({ profile: "named:work" }, hostCall());
    expect(out.sessionId).toMatch(/^wbr_/);
    expect(local.opened).toEqual([{ profile: "named:work", headless: true, allowedOrigins: [] }]);
    expect(allowed.requests.map((request) => [request.reason, request.requestKey])).toEqual([
      ["named_profile", "profile:named:work"],
    ]);

    const denied = fakeBrowseProvider("local-browser");
    const refusal = confirmWith(DENY());
    const deniedWorld = await worldOf([browseCandidate(denied, "builtin")], {
      settings: { browse: { allowNamedProfiles: true } },
      browseConfirm: refusal.port,
    });
    const caught = await rejection(deniedWorld.browse.open({ profile: "named:work" }, hostCall()));
    expect(caught.data.code).toBe("confirmation_denied");
    expect(refusal.requests.map((request) => request.reason)).toEqual(["named_profile"]);
    expect(denied.opened).toEqual([]);

    const noPort = fakeBrowseProvider("local-browser");
    const noPortWorld = await worldOf([browseCandidate(noPort, "builtin")], {
      settings: { browse: { allowNamedProfiles: true } },
    });
    const withoutPort = await rejection(
      noPortWorld.browse.open({ profile: "named:work" }, hostCall()),
    );
    expect(withoutPort.data.code).toBe("confirmation_denied");
    expect(noPort.opened).toEqual([]);
  });
});
