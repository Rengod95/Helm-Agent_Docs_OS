import { describe, expect, test } from "bun:test";
import { createScreenLedger } from "../../../src/views/ledger.ts";
import {
  appBase,
  appFrameCsp,
  appResponseHeaders,
  attachFrame,
  buildAppUrl,
  createConfirmMemory,
  FRAME_SANDBOX,
  HOST_DOCUMENT_CSP,
  parseAppUrl,
  READY_TIMEOUT_MS,
  type FrameElementLike,
  type FrameHost,
  type MessageEventLike,
} from "../../../src/views/app/index.ts";
import { collectThemeTokens, tokenValueAllowed } from "../../../src/views/app/theme.ts";
import { confirmButtons, confirmLineText } from "../../../src/views/app/confirm-line.ts";
import {
  fakeBackend,
  flush,
  ManualTime,
  policyContext,
  portPair,
  request,
  type PortPair,
} from "./support.ts";

interface Sent {
  readonly message: unknown;
  readonly targetOrigin: string;
  readonly transfer: unknown[];
}

function setupFrame() {
  const time = new ManualTime();
  const ledger = createScreenLedger();
  const attributes: Record<string, string> = {};
  const loadListeners = new Set<() => void>();
  const messageListeners = new Set<(event: MessageEventLike) => void>();
  const sent: Sent[] = [];
  const frameWindow = {
    postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void {
      sent.push({ message, targetOrigin, transfer });
    },
  };
  const element: FrameElementLike<unknown> = {
    setAttribute(name, value) {
      attributes[name] = value;
    },
    contentWindow: frameWindow,
    addEventListener(_type, listener) {
      loadListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      loadListeners.delete(listener);
    },
  };
  const channels: PortPair[] = [];
  const closed: string[] = [];
  const { backend } = fakeBackend();
  const host: FrameHost = attachFrame({
    element,
    messages: {
      addEventListener(_type, listener) {
        messageListeners.add(listener);
      },
      removeEventListener(_type, listener) {
        messageListeners.delete(listener);
      },
    },
    url: "fresnel-view://helm/1.0.0/index.html",
    declaredBridge: "^1.0.0",
    createChannel: () => {
      const pair = portPair();
      channels.push(pair);
      return { port1: pair.host, port2: pair.frame };
    },
    scheduler: time,
    ledger,
    screenKey: "helm/app",
    bridge: {
      context: () => policyContext(),
      backend,
      clock: time,
      confirm: () => Promise.resolve("deny"),
      confirmMemory: createConfirmMemory(),
    },
    initialPushes: () => [{ name: "theme", value: { scheme: "dark" } }],
    onClosed: (reason) => closed.push(reason),
  });
  const emit = (event: MessageEventLike): void => {
    for (const listener of messageListeners) listener(event);
  };
  const fireLoad = (): void => {
    for (const listener of loadListeners) listener();
  };
  return {
    time,
    ledger,
    attributes,
    sent,
    frameWindow,
    channels,
    closed,
    host,
    emit,
    fireLoad,
    messageListeners,
    loadListeners,
  };
}

const READY = { v: 1, ready: true, bridge: "^1.0.0" } as const;

describe("frame host", () => {
  test("attributes: sandbox is exactly allow-scripts, no referrer, no permissions, then src", () => {
    const { attributes } = setupFrame();
    expect(FRAME_SANDBOX).toBe("allow-scripts");
    expect(attributes).toEqual({
      sandbox: "allow-scripts",
      referrerpolicy: "no-referrer",
      allow: "",
      src: "fresnel-view://helm/1.0.0/index.html",
    });
  });

  test("ready from the frame's own window hands over one port once, then the bridge answers", async () => {
    const { emit, frameWindow, sent, channels, host, time } = setupFrame();
    emit({ source: frameWindow, data: READY });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toEqual({ v: 1, ready: true, bridge: "1.0.0" });
    expect(sent[0]?.targetOrigin).toBe("*");
    expect(sent[0]?.transfer).toEqual([channels[0]?.frame]);
    expect(host.state).toBe("ready");
    // 두 번째 ready는 무시한다. 포트는 다시 넘어가지 않는다
    emit({ source: frameWindow, data: READY });
    expect(sent).toHaveLength(1);
    expect(channels).toHaveLength(1);
    // 처음 푸시와 첫 ping
    expect(channels[0]?.toFrame).toEqual([
      { v: 1, push: "theme", value: { scheme: "dark" } },
      { v: 1, push: "ping", value: { n: 1 } },
    ]);
    channels[0]?.frame.send(request(5, "host", {}));
    await flush();
    expect(channels[0]?.toFrame[2]).toMatchObject({ v: 1, id: 5, ok: true });
    expect(time.pending()).toBe(1);
  });

  test("a ready from another window is ignored without counting", () => {
    const { emit, sent, ledger, host } = setupFrame();
    emit({ source: { other: true }, data: READY });
    emit({ source: null, data: READY });
    expect(sent).toEqual([]);
    expect(host.state).toBe("loading");
    expect(ledger.stateOf("helm/app")).toEqual({ state: "active", consecutive: 0 });
  });

  test("a ready with the wrong shape or another bridge range closes the frame and counts", () => {
    const wrongRange = setupFrame();
    wrongRange.emit({
      source: wrongRange.frameWindow,
      data: { v: 1, ready: true, bridge: "^2.0.0" },
    });
    expect(wrongRange.sent).toEqual([]);
    expect(wrongRange.closed).toEqual(["bridge_format"]);
    expect(wrongRange.ledger.stateOf("helm/app")).toEqual({ state: "active", consecutive: 1 });

    const wrongShape = setupFrame();
    wrongShape.emit({ source: wrongShape.frameWindow, data: { ready: "yes" } });
    expect(wrongShape.closed).toEqual(["bridge_format"]);
    expect(wrongShape.host.state).toBe("closed");
  });

  test("no ready in 5 s closes the frame as ready_timeout", () => {
    const { time, closed, ledger, host, messageListeners } = setupFrame();
    time.advance(READY_TIMEOUT_MS - 1);
    expect(closed).toEqual([]);
    time.advance(1);
    expect(closed).toEqual(["ready_timeout"]);
    expect(host.state).toBe("closed");
    expect(ledger.stateOf("helm/app")).toEqual({ state: "active", consecutive: 1 });
    expect(messageListeners.size).toBe(0);
  });

  test("the first load is normal, a second load (the frame navigated away) takes the port back", () => {
    const { fireLoad, emit, frameWindow, closed, channels, loadListeners } = setupFrame();
    fireLoad();
    emit({ source: frameWindow, data: READY });
    expect(closed).toEqual([]);
    fireLoad();
    expect(closed).toEqual(["frame_navigated"]);
    expect(channels[0]?.closedByHost()).toBe(true);
    expect(loadListeners.size).toBe(0);
  });

  test("dispose removes listeners, clears the timer and closes the bridge", () => {
    const { host, closed, time, messageListeners, loadListeners } = setupFrame();
    host.dispose();
    expect(closed).toEqual(["disposed"]);
    expect(time.pending()).toBe(0);
    expect(messageListeners.size).toBe(0);
    expect(loadListeners.size).toBe(0);
  });

  test("liveness loss through the frame closes it and reports once", () => {
    const { emit, frameWindow, time, closed } = setupFrame();
    emit({ source: frameWindow, data: READY });
    time.advance(5000);
    time.advance(5000);
    expect(closed).toEqual(["liveness_lost"]);
  });
});

describe("app scheme", () => {
  test("build and parse round trip, path segments are encoded", () => {
    expect(buildAppUrl("helm", "1.0.0", "ui/index.html")).toBe(
      "fresnel-view://helm/1.0.0/ui/index.html",
    );
    expect(buildAppUrl("helm", "1.0.0", "a b.js")).toBe("fresnel-view://helm/1.0.0/a%20b.js");
    expect(parseAppUrl("fresnel-view://helm/1.0.0/ui/index.html")).toEqual({
      extension: "helm",
      version: "1.0.0",
      path: "ui/index.html",
    });
    expect(parseAppUrl("fresnel-view://helm/1.0.0/")).toEqual({
      extension: "helm",
      version: "1.0.0",
      path: "",
    });
  });

  test("hostile names, versions and paths are refused", () => {
    expect(buildAppUrl("../x", "1.0.0", "a")).toBeUndefined();
    expect(buildAppUrl("Helm", "1.0.0", "a")).toBeUndefined();
    expect(buildAppUrl("helm", "latest", "a")).toBeUndefined();
    expect(buildAppUrl("helm", "1.0.0", "../a")).toBeUndefined();
    expect(buildAppUrl("helm", "1.0.0", "a//b")).toBeUndefined();
    expect(buildAppUrl("helm", "1.0.0", "a\\b")).toBeUndefined();
    for (const bad of [
      "https://helm/1.0.0/a.js",
      "fresnel-view://helm/latest/a.js",
      "fresnel-view://user:pw@helm/1.0.0/a.js",
      "fresnel-view://helm/1.0.0/a.js?x=1",
      "fresnel-view://helm/1.0.0/a.js#x",
      "fresnel-view://HELM%20X/1.0.0/a.js",
      "nonsense",
    ]) {
      expect(parseAppUrl(bad)).toBeUndefined();
    }
    // URL 규칙은 `%2e%2e`를 점 마디로 보고 접는다. 버전 자리가 밀려 모양이 틀리므로 거부된다
    expect(parseAppUrl("fresnel-view://helm/1.0.0/%2e%2e/secret")).toBeUndefined();
    // 두 번 인코딩한 것은 그대로 넘어가고 resolveAppFile이 한 번만 풀어 글자 그대로 다룬다
    expect(parseAppUrl("fresnel-view://helm/1.0.0/%252e%252e/secret")?.path).toBe(
      "%252e%252e/secret",
    );
  });

  test("the caustic tokens host is recognised", () => {
    expect(parseAppUrl("fresnel-view://_caustic/1/tokens.css")).toEqual({
      extension: "_caustic",
      version: "1",
      path: "tokens.css",
    });
  });

  test("the frame CSP pins every source to the extension version prefix and blocks the network", () => {
    const base = appBase("helm", "1.0.0");
    expect(base).toBe("fresnel-view://helm/1.0.0/");
    expect(appFrameCsp("fresnel-view://helm/1.0.0/")).toBe(
      "default-src 'none'; script-src fresnel-view://helm/1.0.0/; style-src fresnel-view://helm/1.0.0/ 'unsafe-inline'; img-src fresnel-view://helm/1.0.0/ data: blob:; font-src fresnel-view://helm/1.0.0/; media-src fresnel-view://helm/1.0.0/ blob:; connect-src 'none'; frame-src 'none'; worker-src fresnel-view://helm/1.0.0/ blob:; form-action 'none'; base-uri 'none'",
    );
    expect(HOST_DOCUMENT_CSP).toBe(
      "default-src 'self'; connect-src ipc: http://ipc.localhost; frame-src fresnel-view:",
    );
    const headers = appResponseHeaders("text/html; charset=utf-8", "fresnel-view://helm/1.0.0/");
    expect(headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(headers?.["Content-Security-Policy"]).toBe(appFrameCsp("fresnel-view://helm/1.0.0/"));
    expect(headers?.["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers?.["Cache-Control"]).toBe("no-store");
  });

  test("a base that could break the CSP list is refused", () => {
    for (const bad of [
      "fresnel-view://helm/1.0.0",
      "fresnel-view://a b/1.0.0/",
      "fresnel-view://x/;script-src */",
      "x",
      "fresnel-view://x/'unsafe-eval'/",
    ]) {
      expect(appFrameCsp(bad)).toBeUndefined();
      expect(appResponseHeaders("text/html", bad)).toBeUndefined();
    }
    expect(appBase("../x", "1.0.0")).toBeUndefined();
    expect(appBase("helm", "x")).toBeUndefined();
  });
});

describe("theme tokens and confirm line", () => {
  test("only well-formed names and plain values are collected", () => {
    const table: Record<string, string> = {
      "--c-bg": " #101010 ",
      "--c-bad": "red; background: url(x)",
      "--c-url": "url(https://evil.example/x)",
      "--c-brace": "}",
      "--c-ok2": "rgb(1 2 3 / 50%)",
      "--Not-Lower": "1",
      "--c-empty": "   ",
    };
    const tokens = collectThemeTokens(Object.keys(table), (name) => table[name] ?? "");
    expect(tokens).toEqual({ "--c-bg": "#101010", "--c-ok2": "rgb(1 2 3 / 50%)" });
    expect(tokenValueAllowed("--x", "a\nb")).toBe(false);
    expect(tokenValueAllowed("--x", "@import 'a'")).toBe(false);
    expect(tokenValueAllowed("x", "1")).toBe(false);
  });

  test("the confirmation line is built only from manifest values", () => {
    expect(confirmLineText({ extension: "helm", action: "start", approval: false })).toBe(
      '"helm" 확장이 "start" 동작을 하려고 해요',
    );
    expect(confirmButtons().map((button) => button.answer)).toEqual([
      "allow",
      "allow_always",
      "deny",
    ]);
  });
});
