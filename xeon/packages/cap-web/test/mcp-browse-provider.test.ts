import { afterEach, describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import {
  CapabilityError,
  type BrowseActInput,
  type BrowseReadInput,
  type BrowserOpenOptions,
  type BrowserSessionHandle,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { createMcpBrowseProvider } from "../src/browse/mcp-provider.ts";
import {
  DEFAULT_SNAPSHOT_YAML,
  DEFAULT_TITLE,
  fakeBrowserMcp,
  pageStateText,
  type BrowserMcpReply,
  type FakeBrowserMcp,
} from "../src/testing/fake-browser-mcp.ts";
import { threadIdOf } from "./support/ids.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// Playwright MCP 경로의 `WebBrowseProvider`(L2.web.spec §4.10.4a). 가짜 포트가 받은 도구 호출 기록과 돌려준 값으로 판정한다.
// 도구 이름과 인자는 [가정]이다. 시험은 이 저장소가 정한 매핑이 바뀌지 않았는지를 본다.

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
const PAY_NOW = 'button "Pay now"';

function markdown(text: string): BrowserMcpReply {
  return ok({ text, images: [], isError: false });
}

/** 기본 스냅샷 대신 `yaml`을 돌려주는 가짜 포트. 페이지 주소는 SHOP이다 */
function fakeWithSnapshot(yaml: string): FakeBrowserMcp {
  return fakeBrowserMcp({
    replies: { browser_snapshot: () => markdown(pageStateText(SHOP, "Shop", yaml)) },
  });
}

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

/** 열고 SHOP으로 이동한 핸들. 호출 기록은 이동의 두 번(navigate, snapshot)을 이미 담는다 */
async function openShop(fake: FakeBrowserMcp): Promise<BrowserSessionHandle> {
  const handle = await createMcpBrowseProvider(fake).open(OPEN, SIGNAL);
  await handle.navigate(SHOP, SIGNAL);
  return handle;
}

describe("playwright-mcp provider: 탐침과 매니페스트", () => {
  test("isAvailable maps the port's unreachable answer to ProviderAvailabilityWeb", async () => {
    const down = createMcpBrowseProvider(
      fakeBrowserMcp({ available: { ok: false, detail: "no server" } }),
    );
    expect(await down.isAvailable(SIGNAL)).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "no server",
    });
    const up = createMcpBrowseProvider(fakeBrowserMcp());
    expect(await up.isAvailable(SIGNAL)).toEqual({ ok: true });
  });

  test("the id and manifest are the fixed playwright-mcp values", () => {
    const provider = createMcpBrowseProvider(fakeBrowserMcp());
    expect(provider.id).toBe("playwright-mcp");
    expect(provider.manifest).toEqual({
      name: "playwright-mcp",
      displayName: "Playwright MCP",
      services: ["browse"],
      endpoints: [],
      auth: { kind: "none", secrets: [] },
      pricing: {
        asOf: "2026-10-29",
        sourceUrl: "https://github.com/microsoft/playwright-mcp",
        currency: "USD",
        units: {},
      },
      termsFlags: { cachePolicy: "none", mayTrainOn: false, redistribution: "unknown" },
      privacy: { zdr: "unknown", sendsTelemetry: false },
      limits: {},
    });
  });
});

describe("playwright-mcp provider: 열기와 이동", () => {
  test("open then navigate sends browser_navigate and browser_snapshot and parses the page", async () => {
    const fake = fakeBrowserMcp();
    const handle = await createMcpBrowseProvider(fake).open(OPEN, SIGNAL);
    const step = await handle.navigate(SHOP, SIGNAL);
    expect(fake.calls).toEqual([
      { tool: "browser_navigate", args: { url: SHOP } },
      { tool: "browser_snapshot", args: {} },
    ]);
    expect(step.page).toEqual({ url: SHOP, title: DEFAULT_TITLE, tabId: "t1" });
    expect(step.navigations).toEqual([SHOP]);
    expect(step.snapshot).toEqual({
      format: "aria-yaml",
      kind: "full",
      revision: 1,
      text: DEFAULT_SNAPSHOT_YAML,
      refs: [
        { ref: "e3", role: "button", name: "Pay now" },
        { ref: "e4", role: "link", name: "Docs" },
      ],
    });
  });

  test("each snapshot increments the revision", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const out = await handle.read(read("snapshot"), SIGNAL);
    expect(out.snapshot?.revision).toBe(2);
  });

  test("snapshot refs are capped at 4000", async () => {
    const yaml = Array.from(
      { length: 4005 },
      (_, index) => `- button "b${index}" [ref=e${index + 1}]`,
    ).join("\n");
    const handle = await openShop(fakeWithSnapshot(yaml));
    const out = await handle.read(read("snapshot"), SIGNAL);
    expect(out.snapshot?.refs.length).toBe(4000);
    expect(out.snapshot?.refs.at(-1)).toEqual({ ref: "e4000", role: "button", name: "b3999" });
  });

  test("a result without a page URL is an upstream error", async () => {
    const fake = fakeBrowserMcp({
      replies: { browser_snapshot: () => markdown("### Result\nnothing here") },
    });
    const handle = await createMcpBrowseProvider(fake).open(OPEN, SIGNAL);
    const caught = await rejection(handle.navigate(SHOP, SIGNAL));
    expect(caught.data.code).toBe("upstream_error");
    expect(caught.data.retryable).toBe(true);
  });
});

describe("playwright-mcp provider: 동작 매핑", () => {
  test("click by ref sends browser_click with the role and name of the snapshot ref", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("click", { target: { ref: "e3" } }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([
      { tool: "browser_click", args: { element: PAY_NOW, ref: "e3" } },
      { tool: "browser_snapshot", args: {} },
    ]);
  });

  test("a ref without a name uses the ref as the element", async () => {
    const fake = fakeWithSnapshot("- img [ref=e7]");
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("click", { target: { ref: "e7" } }), SIGNAL);
    expect(fake.calls[before]).toEqual({
      tool: "browser_click",
      args: { element: "e7", ref: "e7" },
    });
  });

  test("type and fill both send browser_type with submit false", async () => {
    const fake = fakeWithSnapshot('- textbox "Search" [ref=e2]');
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("type", { target: { ref: "e2" }, text: "shoes" }), SIGNAL);
    await handle.act(act("fill", { target: { ref: "e2" }, text: "cats" }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([
      {
        tool: "browser_type",
        args: { element: 'textbox "Search"', ref: "e2", text: "shoes", submit: false },
      },
      { tool: "browser_snapshot", args: {} },
      {
        tool: "browser_type",
        args: { element: 'textbox "Search"', ref: "e2", text: "cats", submit: false },
      },
      { tool: "browser_snapshot", args: {} },
    ]);
  });

  test("hover and select take the ref and element", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("hover", { target: { ref: "e3" } }), SIGNAL);
    await handle.act(act("select", { target: { ref: "e3" }, values: ["a", "b"] }), SIGNAL);
    expect(fake.calls.slice(before).map((call) => call.tool)).toEqual([
      "browser_hover",
      "browser_snapshot",
      "browser_select_option",
      "browser_snapshot",
    ]);
    expect(fake.calls[before + 2]).toEqual({
      tool: "browser_select_option",
      args: { element: PAY_NOW, ref: "e3", values: ["a", "b"] },
    });
  });

  test("key, scroll, wait, back and evaluate map to page-level tools", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("key", { key: "Enter" }), SIGNAL);
    await handle.act(act("scroll", { direction: "down", amount: 3 }), SIGNAL);
    await handle.act(act("wait", { timeoutMs: 1500 }), SIGNAL);
    await handle.act(act("back"), SIGNAL);
    await handle.act(act("evaluate", { text: "() => document.title" }), SIGNAL);
    expect(fake.calls.slice(before)).toEqual([
      { tool: "browser_press_key", args: { key: "Enter" } },
      { tool: "browser_snapshot", args: {} },
      { tool: "browser_press_key", args: { key: "PageDown" } },
      { tool: "browser_press_key", args: { key: "PageDown" } },
      { tool: "browser_press_key", args: { key: "PageDown" } },
      { tool: "browser_snapshot", args: {} },
      { tool: "browser_wait_for", args: { time: 2 } },
      { tool: "browser_snapshot", args: {} },
      { tool: "browser_navigate_back", args: {} },
      { tool: "browser_snapshot", args: {} },
      { tool: "browser_evaluate", args: { function: "() => document.title" } },
      { tool: "browser_snapshot", args: {} },
    ]);
  });

  test("scroll repeats at most 20 presses and defaults to one ArrowRight for right", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    await handle.act(act("scroll", { direction: "up", amount: 25 }), SIGNAL);
    const pressed = fake.calls.slice(before, -1);
    expect(pressed.length).toBe(20);
    expect(new Set(pressed.map((call) => call.tool))).toEqual(new Set(["browser_press_key"]));
    expect(new Set(pressed.map((call) => call.args["key"]))).toEqual(new Set(["PageUp"]));
    await handle.act(act("scroll", { direction: "right" }), SIGNAL);
    expect(fake.calls.at(-2)).toEqual({ tool: "browser_press_key", args: { key: "ArrowRight" } });
  });

  test("forward and upload are unsupported and send nothing", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const forward = await rejection(handle.act(act("forward"), SIGNAL));
    const upload = await rejection(handle.act(act("upload"), SIGNAL));
    expect([forward.data.code, upload.data.code]).toEqual(["unsupported", "unsupported"]);
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("coordinate targets are invalid_input", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const caught = await rejection(handle.act(act("click", { target: { x: 10, y: 20 } }), SIGNAL));
    expect(caught.data.code).toBe("invalid_input");
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("a ref that is not in the last snapshot is ref_invalid and sends nothing", async () => {
    const fake = fakeBrowserMcp();
    const handle = await openShop(fake);
    const before = fake.calls.length;
    const clicked = await rejection(handle.act(act("click", { target: { ref: "e99" } }), SIGNAL));
    expect(clicked.data).toMatchObject({ code: "ref_invalid", retryable: false });
    const described = await rejection(handle.describe({ ref: "e99" }, SIGNAL));
    expect(described.data.code).toBe("ref_invalid");
    expect(fake.calls.slice(before)).toEqual([]);
  });

  test("describe returns the role and name of a snapshot ref", async () => {
    const handle = await openShop(fakeBrowserMcp());
    expect(await handle.describe({ ref: "e3" }, SIGNAL)).toEqual({
      role: "button",
      name: "Pay now",
    });
    expect(await handle.describe({ ref: "e4" }, SIGNAL)).toEqual({ role: "link", name: "Docs" });
  });

  test("a failed tool result is upstream_error with the text cut to 500 characters", async () => {
    const long = "x".repeat(600);
    const fake = fakeBrowserMcp({
      replies: { browser_click: () => ok({ text: long, images: [], isError: true }) },
    });
    const handle = await openShop(fake);
    const caught = await rejection(handle.act(act("click", { target: { ref: "e3" } }), SIGNAL));
    expect(caught.data).toMatchObject({
      code: "upstream_error",
      retryable: true,
      message: `playwright-mcp browser_click failed: ${"x".repeat(500)}`,
    });
  });

  test("port failures map to unavailable and aborted", async () => {
    const down = fakeBrowserMcp({
      replies: { browser_click: () => err({ kind: "unavailable", message: "server closed" }) },
    });
    const handleDown = await openShop(down);
    const unavailable = await rejection(
      handleDown.act(act("click", { target: { ref: "e3" } }), SIGNAL),
    );
    expect(unavailable.data).toMatchObject({
      code: "unavailable",
      message: "server closed",
      retryable: true,
    });

    const cut = fakeBrowserMcp({
      replies: { browser_click: () => err({ kind: "aborted" }) },
    });
    const handleCut = await openShop(cut);
    const aborted = await rejection(handleCut.act(act("click", { target: { ref: "e3" } }), SIGNAL));
    expect(aborted.data).toMatchObject({ code: "aborted", retryable: false });
  });
});

describe("playwright-mcp provider: 읽기", () => {
  test("text mode returns the snapshot text and no snapshot", async () => {
    const handle = await openShop(fakeBrowserMcp());
    const out = await handle.read(read("text"), SIGNAL);
    expect(out).toEqual({
      page: { url: SHOP, title: DEFAULT_TITLE, tabId: "t1" },
      text: DEFAULT_SNAPSHOT_YAML,
    });
  });

  test("find keeps the snapshot lines whose role or name contains the query, ignoring case", async () => {
    const handle = await openShop(fakeBrowserMcp());
    const pay = await handle.read(read("find", { query: "pay" }), SIGNAL);
    expect(pay.text).toBe('- button "Pay now" [ref=e3]');
    const docs = await handle.read(read("find", { query: "DOCS" }), SIGNAL);
    expect(docs.text).toBe('- link "Docs" [ref=e4]');
    const byRole = await handle.read(read("find", { query: "link" }), SIGNAL);
    expect(byRole.text).toBe('- link "Docs" [ref=e4]');
    const none = await handle.read(read("find", { query: "zzz" }), SIGNAL);
    expect(none.text).toBe("");
  });

  test("find without a query is invalid_input", async () => {
    const handle = await openShop(fakeBrowserMcp());
    const caught = await rejection(handle.read(read("find"), SIGNAL));
    expect(caught.data.code).toBe("invalid_input");
  });

  test("screenshot takes the first image as PNG or JPEG with a 1x1 size", async () => {
    const fake = fakeBrowserMcp({
      replies: {
        browser_take_screenshot: () =>
          ok({
            text: "",
            images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }],
            isError: false,
          }),
      },
    });
    const handle = await openShop(fake);
    const out = await handle.read(read("screenshot"), SIGNAL);
    expect(out).toEqual({
      page: { url: SHOP, title: DEFAULT_TITLE, tabId: "t1" },
      screenshot: { mediaType: "image/png", data: "iVBORw0KGgo=", width: 1, height: 1 },
    });
    expect(fake.calls.at(-1)?.tool).toBe("browser_take_screenshot");
  });

  test("a screenshot that is not PNG or JPEG is upstream_error", async () => {
    const fake = fakeBrowserMcp({
      replies: {
        browser_take_screenshot: () =>
          ok({ text: "", images: [{ mediaType: "image/gif", data: "R0lGOD" }], isError: false }),
      },
    });
    const handle = await openShop(fake);
    const caught = await rejection(handle.read(read("screenshot"), SIGNAL));
    expect(caught.data).toMatchObject({ code: "upstream_error" });
  });

  test("a screenshot result with no image is upstream_error", async () => {
    const fake = fakeBrowserMcp({
      replies: { browser_take_screenshot: () => markdown("no picture") },
    });
    const handle = await openShop(fake);
    const caught = await rejection(handle.read(read("screenshot"), SIGNAL));
    expect(caught.data).toMatchObject({ code: "upstream_error" });
  });
});

describe("playwright-mcp provider: 한 세션과 닫기", () => {
  test("a second open is rejected until the first session is closed", async () => {
    const fake = fakeBrowserMcp();
    const provider = createMcpBrowseProvider(fake);
    const first = await provider.open(OPEN, SIGNAL);
    const second = await rejection(provider.open(OPEN, SIGNAL));
    expect(second.data).toMatchObject({
      code: "unavailable",
      message: "playwright-mcp supports one session",
    });
    await first.close();
    const third = await provider.open(OPEN, SIGNAL);
    expect(third).toBeDefined();
  });

  test("close sends browser_close once and a closed handle is not_found", async () => {
    const fake = fakeBrowserMcp();
    const provider = createMcpBrowseProvider(fake);
    const handle = await provider.open(OPEN, SIGNAL);
    await handle.close();
    await handle.close();
    expect(fake.calls).toEqual([{ tool: "browser_close", args: {} }]);
    const caught = await rejection(handle.navigate(SHOP, SIGNAL));
    expect(caught.data).toMatchObject({ code: "not_found", retryable: false });
    expect(fake.calls.length).toBe(1);
  });

  test("a named profile is unsupported and sends nothing", async () => {
    const fake = fakeBrowserMcp();
    const provider = createMcpBrowseProvider(fake);
    const caught = await rejection(provider.open({ ...OPEN, profile: "named:work" }, SIGNAL));
    expect(caught.data.code).toBe("unsupported");
    expect(fake.calls).toEqual([]);
  });
});

describe("playwright-mcp provider: web.browse에서", () => {
  test("open selects playwright-mcp as the only browser candidate", async () => {
    const fake = fakeBrowserMcp();
    const world = await makeWebWorld({ browserMcp: fake });
    const out = await world.browse.open({ url: SHOP }, HOST);
    expect(out.meta).toMatchObject({
      provider: "playwright-mcp",
      selectedBy: "auto",
      fallbacks: [],
    });
    expect(out.page).toEqual({ url: SHOP, title: DEFAULT_TITLE, tabId: "t1" });
    expect(fake.calls.map((call) => call.tool)).toEqual(["browser_navigate", "browser_snapshot"]);
  });

  test("without a browserMcp port there is no browser candidate", async () => {
    const world = await makeWebWorld();
    const caught = await rejection(world.browse.open({}, HOST));
    expect(caught.data).toMatchObject({
      code: "unavailable",
      detail: { reason: "no_provider", fallbacks: [] },
    });
  });

  test("a Pay now click is refused without a confirm port and never reaches the tool", async () => {
    const fake = fakeBrowserMcp();
    const world = await makeWebWorld({ browserMcp: fake });
    const { sessionId } = await world.browse.open({ url: SHOP }, HOST);
    const caught = await rejection(
      world.browse.act({ sessionId, action: "click", target: { ref: "e3" } }, HOST),
    );
    expect(caught.data).toMatchObject({
      code: "confirmation_denied",
      detail: { reason: "sensitive_click" },
    });
    expect(fake.calls.map((call) => call.tool)).toEqual(["browser_navigate", "browser_snapshot"]);
  });

  test("a Docs click runs through the tool", async () => {
    const fake = fakeBrowserMcp();
    const world = await makeWebWorld({ browserMcp: fake });
    const { sessionId } = await world.browse.open({ url: SHOP }, HOST);
    const out = await world.browse.act({ sessionId, action: "click", target: { ref: "e4" } }, HOST);
    expect(out.page).toEqual({ url: SHOP, title: DEFAULT_TITLE, tabId: "t1" });
    expect(fake.calls.at(-2)).toEqual({
      tool: "browser_click",
      args: { element: 'link "Docs"', ref: "e4" },
    });
  });
});
