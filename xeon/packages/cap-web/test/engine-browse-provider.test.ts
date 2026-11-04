import { afterEach, describe, expect, test } from "bun:test";
import {
  CapabilityError,
  type BrowseActInput,
  type BrowseReadInput,
  type BrowserOpenOptions,
  type BrowserSessionHandle,
  type CallOptions,
} from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createEngineBrowseProvider } from "../src/browse/engine-provider.ts";
import {
  EXAMPLE_PAGE,
  fakeBrowserEngine,
  type FakeBrowserEngine,
} from "../src/testing/fake-browser-engine.ts";
import { fakeBrowserMcp } from "../src/testing/fake-browser-mcp.ts";
import { threadIdOf } from "./support/ids.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// Stagehand 엔진 경로의 `WebBrowseProvider`(L2.web.spec §4.10.4a). 가짜 엔진이 받은 동작 호출과 돌려준 값으로 판정한다.
// 예시 트리는 §4.10.4a의 예시이고 버튼 "Pay now"는 frame-node `0-11`, XPath `/html[1]/body[1]/button[1]`이다.

afterEach(releaseStores);

const SIGNAL = new AbortController().signal;
const SESSION = "wbr_test";
const SHOP = "https://example.com/shop";
const OPEN: BrowserOpenOptions = { profile: "ephemeral", headless: true, allowedOrigins: [] };
const THREAD: ThreadId = threadIdOf(1);
const HOST: CallOptions = {
  requestId: "req-host",
  context: { threadId: THREAD, caller: { kind: "host" } },
};
const PAGE_OF_SHOP = { url: SHOP, title: "Shop", tabId: "t1" };
const PAY_NOW_XPATH = "/html[1]/body[1]/button[1]";
const NAME_XPATH = "/html[1]/body[1]/input[1]";

/** 두 번째 스냅샷에서 버튼 "Pay now"가 빠진 페이지 */
const WITHOUT_BUTTON = "[0-2] RootWebArea: T\n  [0-4] body\n    [0-9] heading: Hi";

function act(
  action: BrowseActInput["action"],
  rest: Omit<BrowseActInput, "sessionId" | "action"> = {},
): BrowseActInput {
  return { sessionId: SESSION, action, ...rest };
}

function read(
  mode: BrowseReadInput["mode"],
  rest: Omit<BrowseReadInput, "sessionId" | "mode"> = {},
): BrowseReadInput {
  return { sessionId: SESSION, mode, ...rest };
}

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

/** 열고 SHOP으로 이동한 핸들. 예시 트리가 기본 페이지다 */
async function openShop(fake: FakeBrowserEngine): Promise<BrowserSessionHandle> {
  const handle = await createEngineBrowseProvider(fake).open(OPEN, SIGNAL);
  await handle.navigate(SHOP, SIGNAL);
  return handle;
}

describe("stagehand provider: 탐침과 매니페스트", () => {
  test("isAvailable maps the engine's unavailable answer to ProviderAvailabilityWeb", async () => {
    const down = createEngineBrowseProvider(
      fakeBrowserEngine({ available: { ok: false, detail: "no chrome" } }),
    );
    expect(await down.isAvailable(SIGNAL)).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "no chrome",
    });
    const up = createEngineBrowseProvider(fakeBrowserEngine());
    expect(await up.isAvailable(SIGNAL)).toEqual({ ok: true });
  });

  test("the id and manifest are the fixed stagehand values", () => {
    const provider = createEngineBrowseProvider(fakeBrowserEngine());
    expect(provider.id).toBe("stagehand");
    expect(provider.manifest).toMatchObject({
      name: "stagehand",
      displayName: "Stagehand",
      services: ["browse"],
      endpoints: [],
      auth: { kind: "none", secrets: [] },
      termsFlags: { cachePolicy: "none" },
      limits: {},
    });
  });
});

describe("stagehand provider: 스냅샷과 ref", () => {
  test("navigate maps the example tree to refs e1 to e7 in tree order", async () => {
    const handle = await createEngineBrowseProvider(fakeBrowserEngine()).open(OPEN, SIGNAL);
    const step = await handle.navigate(SHOP, SIGNAL);
    expect(step.page).toEqual(PAGE_OF_SHOP);
    expect(step.snapshot).toMatchObject({ format: "aria-yaml", kind: "full", revision: 1 });
    expect(step.snapshot?.refs).toEqual([
      { ref: "e1", role: "RootWebArea", name: "T" },
      { ref: "e2", role: "scrollable, html" },
      { ref: "e3", role: "body" },
      { ref: "e4", role: "heading", name: "Hi" },
      { ref: "e5", role: "button", name: "Pay now" },
      { ref: "e6", role: "link", name: "link" },
      { ref: "e7", role: "textbox", name: "Name" },
    ]);
  });

  test("the snapshot text shows each ref, and a link's href sits under the link", async () => {
    const handle = await createEngineBrowseProvider(fakeBrowserEngine()).open(OPEN, SIGNAL);
    const step = await handle.navigate(SHOP, SIGNAL);
    expect(step.snapshot?.text).toBe(
      [
        '- RootWebArea "T" [ref=e1]',
        "  - scrollable, html [ref=e2]",
        "    - body [ref=e3]",
        '      - heading "Hi" [ref=e4]',
        '      - button "Pay now" [ref=e5]',
        '      - link "link" [ref=e6]:',
        "        - /url: https://example.com/x",
        '      - textbox "Name" [ref=e7]',
      ].join("\n"),
    );
  });

  test("a stale ref after a new snapshot is ref_invalid and sends nothing", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    fake.setPage(SHOP, { ...EXAMPLE_PAGE, formattedTree: WITHOUT_BUTTON });
    const read2 = await handle.read(read("snapshot"), SIGNAL);
    expect(read2.snapshot?.revision).toBe(2);
    const before = fake.calls.length;
    const clicked = await rejection(handle.act(act("click", { target: { ref: "e5" } }), SIGNAL));
    expect(clicked.data).toMatchObject({
      code: "ref_invalid",
      retryable: false,
      message: "ref e5 is not in the last snapshot.",
    });
    const described = await rejection(handle.describe({ ref: "e5" }, SIGNAL));
    expect(described.data.code).toBe("ref_invalid");
    const unknown = await rejection(handle.act(act("click", { target: { ref: "e99" } }), SIGNAL));
    expect(unknown.data.code).toBe("ref_invalid");
    expect(fake.calls.slice(before)).toEqual([]);
  });
});

describe("stagehand provider: 동작 매핑", () => {
  test("click by ref calls the engine with the element's XPath", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("click", { target: { ref: "e5" } }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([{ method: "click", xpath: PAY_NOW_XPATH }]);
  });

  test("fill with a ref fills that element, and type without a ref types into the focus", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("fill", { target: { ref: "e7" }, text: "Ann" }), SIGNAL);
    await handle.act(act("type", { target: { ref: "e7" }, text: "Bob" }), SIGNAL);
    await handle.act(act("type", { text: "Enter me" }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([
      { method: "fill", xpath: NAME_XPATH, text: "Ann" },
      { method: "fill", xpath: NAME_XPATH, text: "Bob" },
      { method: "typeText", text: "Enter me" },
    ]);
  });

  test("fill without a ref is invalid_input and sends nothing", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const caught = await rejection(handle.act(act("fill", { text: "x" }), SIGNAL));
    expect(caught.data).toMatchObject({
      code: "invalid_input",
      retryable: false,
      message: "fill needs a ref target.",
    });
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("key, scroll, wait and select map to engine calls with pixel deltas", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("key", { key: "Enter" }), SIGNAL);
    await handle.act(act("scroll", { direction: "down", amount: 3 }), SIGNAL);
    await handle.act(act("scroll", { direction: "left" }), SIGNAL);
    await handle.act(act("wait", { timeoutMs: 1500 }), SIGNAL);
    await handle.act(act("wait"), SIGNAL);
    await handle.act(act("select", { target: { ref: "e5" }, values: ["a", "b"] }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([
      { method: "pressKey", key: "Enter" },
      { method: "scroll", deltaX: 0, deltaY: 1500 },
      { method: "scroll", deltaX: -500, deltaY: 0 },
      { method: "waitMs", ms: 1500 },
      { method: "waitMs", ms: 1000 },
      { method: "selectOption", xpath: PAY_NOW_XPATH, values: ["a", "b"] },
    ]);
  });

  test("scroll moves at most 20 steps", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    await handle.act(act("scroll", { direction: "up", amount: 25 }), SIGNAL);
    expect(fake.calls.at(-1)).toEqual({ method: "scroll", deltaX: 0, deltaY: -10000 });
  });

  test("hover, back, forward, upload and evaluate are unsupported and send nothing", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const hover = await rejection(handle.act(act("hover", { target: { ref: "e5" } }), SIGNAL));
    const back = await rejection(handle.act(act("back"), SIGNAL));
    const forward = await rejection(handle.act(act("forward"), SIGNAL));
    const upload = await rejection(handle.act(act("upload"), SIGNAL));
    const evaluate = await rejection(handle.act(act("evaluate", { text: "() => 1" }), SIGNAL));
    expect([hover, back, forward, upload, evaluate].map((caught) => caught.data.code)).toEqual([
      "unsupported",
      "unsupported",
      "unsupported",
      "unsupported",
      "unsupported",
    ]);
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("coordinate targets are invalid_input and send nothing", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const caught = await rejection(handle.act(act("click", { target: { x: 10, y: 20 } }), SIGNAL));
    expect(caught.data.code).toBe("invalid_input");
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("a ref whose element has no XPath is unsupported and sends nothing", async () => {
    const fake = fakeBrowserEngine({ pages: { [SHOP]: { ...EXAMPLE_PAGE, xpathMap: {} } } });
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const caught = await rejection(handle.act(act("click", { target: { ref: "e5" } }), SIGNAL));
    expect(caught.data).toMatchObject({
      code: "unsupported",
      message: "ref e5 has no element path in the engine snapshot.",
    });
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("describe returns the role and name of a snapshot ref, with no form action for a link", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    expect(await handle.describe({ ref: "e5" }, SIGNAL)).toEqual({
      role: "button",
      name: "Pay now",
    });
    const before = fake.calls.length;
    expect(await handle.describe({ ref: "e6" }, SIGNAL)).toEqual({ role: "link", name: "link" });
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("describe carries the form action of a button so a cross-origin submit can be noticed", async () => {
    const fake = fakeBrowserEngine({
      pages: {
        [SHOP]: {
          ...EXAMPLE_PAGE,
          formActions: { [PAY_NOW_XPATH]: "https://evil.example/collect" },
        },
      },
    });
    const handle = await openShop(fake);
    expect(await handle.describe({ ref: "e5" }, SIGNAL)).toEqual({
      role: "button",
      name: "Pay now",
      formAction: "https://evil.example/collect",
    });
    expect(fake.calls.at(-1)).toEqual({ method: "formAction", xpath: PAY_NOW_XPATH });
  });

  test("a failed engine action is upstream_error, and unavailable and aborted map as they are", async () => {
    const fake = fakeBrowserEngine();
    const handle = await openShop(fake);
    fake.failNextWith({ kind: "failed", message: "no such element" });
    const failed = await rejection(handle.act(act("click", { target: { ref: "e5" } }), SIGNAL));
    expect(failed.data).toMatchObject({
      code: "upstream_error",
      retryable: true,
      message: "stagehand click failed: no such element",
    });
    fake.failNextWith({ kind: "unavailable", message: "chrome closed" });
    const down = await rejection(handle.act(act("click", { target: { ref: "e5" } }), SIGNAL));
    expect(down.data).toMatchObject({
      code: "unavailable",
      message: "chrome closed",
      retryable: true,
    });
    fake.failNextWith({ kind: "aborted" });
    const cut = await rejection(handle.act(act("click", { target: { ref: "e5" } }), SIGNAL));
    expect(cut.data).toMatchObject({ code: "aborted", retryable: false });
  });
});

describe("stagehand provider: 읽기", () => {
  test("text mode returns the engine's page text and no snapshot", async () => {
    const handle = await openShop(fakeBrowserEngine());
    const out = await handle.read(read("text"), SIGNAL);
    expect(out).toEqual({ page: PAGE_OF_SHOP, text: "Shop text" });
  });

  test("find keeps the snapshot lines whose role or name contains the query, ignoring case", async () => {
    const handle = await openShop(fakeBrowserEngine());
    const pay = await handle.read(read("find", { query: "pay" }), SIGNAL);
    expect(pay.text).toBe('      - button "Pay now" [ref=e5]');
    const link = await handle.read(read("find", { query: "LINK" }), SIGNAL);
    expect(link.text).toBe('      - link "link" [ref=e6]:');
    const none = await handle.read(read("find", { query: "zzz" }), SIGNAL);
    expect(none.text).toBe("");
  });

  test("find without a query is invalid_input", async () => {
    const handle = await openShop(fakeBrowserEngine());
    const caught = await rejection(handle.read(read("find"), SIGNAL));
    expect(caught.data.code).toBe("invalid_input");
  });

  test("screenshot returns the engine's PNG with its own size", async () => {
    const handle = await openShop(fakeBrowserEngine());
    const out = await handle.read(read("screenshot"), SIGNAL);
    expect(out).toEqual({
      page: PAGE_OF_SHOP,
      screenshot: { mediaType: "image/png", data: "iVBORw0KGgo=", width: 800, height: 600 },
    });
  });

  test("a screenshot that is not PNG or JPEG is upstream_error", async () => {
    const fake = fakeBrowserEngine({
      screenshot: { mediaType: "image/gif", data: "R0lGOD", width: 1, height: 1 },
    });
    const handle = await openShop(fake);
    const caught = await rejection(handle.read(read("screenshot"), SIGNAL));
    expect(caught.data).toMatchObject({ code: "upstream_error", retryable: true });
  });
});

describe("stagehand provider: 한 세션과 닫기", () => {
  test("a second open is rejected until the first session is closed", async () => {
    const fake = fakeBrowserEngine();
    const provider = createEngineBrowseProvider(fake);
    const first = await provider.open(OPEN, SIGNAL);
    const second = await rejection(provider.open(OPEN, SIGNAL));
    expect(second.data).toMatchObject({
      code: "unavailable",
      retryable: false,
      message: "stagehand supports one session",
    });
    await first.close();
    expect(await provider.open(OPEN, SIGNAL)).toBeDefined();
    expect(fake.opens.length).toBe(2);
  });

  test("a failed open frees the slot for the next open", async () => {
    const fake = fakeBrowserEngine();
    const provider = createEngineBrowseProvider(fake);
    fake.failNextOpenWith({ kind: "unavailable", message: "chrome missing" });
    const failed = await rejection(provider.open(OPEN, SIGNAL));
    expect(failed.data).toMatchObject({
      code: "unavailable",
      message: "chrome missing",
      retryable: true,
    });
    expect(await provider.open(OPEN, SIGNAL)).toBeDefined();
  });

  test("close sends close once and a closed handle is not_found without a call", async () => {
    const fake = fakeBrowserEngine();
    const handle = await createEngineBrowseProvider(fake).open(OPEN, SIGNAL);
    await handle.close();
    await handle.close();
    expect(fake.calls).toEqual([{ method: "close" }]);
    const caught = await rejection(handle.navigate(SHOP, SIGNAL));
    expect(caught.data).toMatchObject({ code: "not_found", retryable: false });
    expect(fake.calls).toEqual([{ method: "close" }]);
  });

  test("open passes the profile and headless flag to the engine, not the allowed origins", async () => {
    const fake = fakeBrowserEngine();
    await createEngineBrowseProvider(fake).open({ ...OPEN, allowedOrigins: [SHOP] }, SIGNAL);
    expect(fake.opens).toEqual([{ headless: true, profile: "ephemeral" }]);
  });
});

describe("stagehand provider: web.browse에서", () => {
  test("the engine is the first browser candidate and playwright-mcp the second", async () => {
    const world = await makeWebWorld({
      browserEngine: fakeBrowserEngine(),
      browserMcp: fakeBrowserMcp(),
    });
    expect(
      world.deps.catalog
        .browseCandidates()
        .map((candidate) => [candidate.provider.id, candidate.origin]),
    ).toEqual([
      ["stagehand", "builtin"],
      ["playwright-mcp", "builtin"],
    ]);
  });

  test("open selects stagehand by default and never touches the mcp server", async () => {
    const engine = fakeBrowserEngine();
    const mcp = fakeBrowserMcp();
    const world = await makeWebWorld({ browserEngine: engine, browserMcp: mcp });
    const out = await world.browse.open({ url: SHOP }, HOST);
    expect(out.meta).toMatchObject({ provider: "stagehand", selectedBy: "auto", fallbacks: [] });
    expect(out.page).toEqual(PAGE_OF_SHOP);
    expect(engine.opens).toEqual([{ headless: true, profile: "ephemeral" }]);
    expect(mcp.calls).toEqual([]);
  });

  test("with the engine down, playwright-mcp is the fallback and the probe failure is recorded", async () => {
    const engine = fakeBrowserEngine({ available: { ok: false, detail: "no chrome" } });
    const world = await makeWebWorld({ browserEngine: engine, browserMcp: fakeBrowserMcp() });
    const out = await world.browse.open({ url: SHOP }, HOST);
    expect(out.meta).toMatchObject({ provider: "playwright-mcp", selectedBy: "auto" });
    expect(out.meta.fallbacks).toEqual([
      { provider: "stagehand", stage: "probe", reason: "unreachable", detail: "no chrome" },
    ]);
    expect(engine.opens).toEqual([]);
  });

  test("a click on Pay now is refused without a confirm port, after only the form lookup", async () => {
    const engine = fakeBrowserEngine();
    const world = await makeWebWorld({ browserEngine: engine });
    const { sessionId } = await world.browse.open({ url: SHOP }, HOST);
    const caught = await rejection(
      world.browse.act({ sessionId, action: "click", target: { ref: "e5" } }, HOST),
    );
    expect(caught.data).toMatchObject({
      code: "confirmation_denied",
      detail: { reason: "sensitive_click" },
    });
    expect(engine.calls).toEqual([
      { method: "goto", url: SHOP },
      { method: "formAction", xpath: PAY_NOW_XPATH },
    ]);
  });
});
