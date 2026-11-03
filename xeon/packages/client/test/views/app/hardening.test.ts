import { describe, expect, test } from "bun:test";
import { createScreenLedger } from "../../../src/views/ledger.ts";
import {
  CONFIRM_COOLDOWN_MS,
  CONFIRM_TIMEOUT_MS,
  createBridgeHost,
  decide,
  defaultAllowPost,
  normalizeExternalLink,
  POST_MIN_INTERVAL_MS,
  stripUnsafeText,
  summarizeParams,
  type BridgeBackend,
  type ConfirmAnswer,
} from "../../../src/views/app/index.ts";
import {
  confirmer,
  fakeBackend,
  flush,
  ManualTime,
  policyContext,
  portPair,
  request,
} from "./support.ts";

/** 항목마다 앞 작업이 끝난 뒤에 이어서 한다(반복 안의 await를 피한다) */
function inOrder<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => step(item)),
    Promise.resolve(),
  );
}

function req(op: Parameters<typeof decide>[0]["op"], args: unknown): Parameters<typeof decide>[0] {
  return { v: 1, id: 1, op, args };
}

describe("external link normalisation", () => {
  test("href comes from new URL and is what confirm and opener get", () => {
    expect(normalizeExternalLink("HTTPS://Example.COM:443/a b".replace(" ", "%20"))).toEqual({
      href: "https://example.com/a%20b",
      display: "https://example.com/a%20b",
      punycodeHost: undefined,
    });
  });

  test("raw control characters, tab, newline, spaces and bidi are rejected", () => {
    for (const raw of [
      "https://example.com/\u0000",
      "https://exa\tmple.com/",
      "https://example.com/\n",
      " https://example.com/",
      "https://example.com/ x",
      "https://example.com/‮",
      "https://example.com/⁦x",
      "https://example.com/\u0085",
    ]) {
      expect(normalizeExternalLink(raw)).toBeUndefined();
    }
  });

  test("an internationalised host is shown as punycode where it differs", () => {
    const link = normalizeExternalLink("https://bücher.example/");
    expect(link?.href).toBe("https://xn--bcher-kva.example/");
    expect(link?.punycodeHost).toBe("xn--bcher-kva.example");
  });

  test("decide hands the normalised href to the action", () => {
    const decision = decide(
      req("navigate", { target: { kind: "external", url: "https://Example.com" } }),
      policyContext(),
    );
    expect(decision).toEqual({
      ok: true,
      action: {
        op: "navigate",
        target: {
          kind: "external",
          url: "https://example.com/",
          link: {
            href: "https://example.com/",
            display: "https://example.com/",
            punycodeHost: undefined,
          },
        },
        needsShellConfirm: true,
      },
    });
    expect(
      decide(
        req("navigate", { target: { kind: "external", url: "https://a.com/\n" } }),
        policyContext(),
      ).ok,
    ).toBe(false);
  });
});

describe("post and requestApproval text", () => {
  test("control and bidi characters are stripped, newlines stay only where layout is kept", () => {
    expect(stripUnsafeText("a‮b\u0007c\nd\te", true)).toBe("abc\nd\te");
    expect(stripUnsafeText("a‮b\u0007c\nd", false)).toBe("abcd");
    const post = decide(
      req("post", { threadId: "thr_1", text: "hi‮\u0000 there" }),
      policyContext(),
    );
    expect(post).toEqual({
      ok: true,
      action: { op: "post", threadId: "thr_1", text: "hi there" },
    });
    const approval = decide(
      req("requestApproval", { threadId: "thr_1", title: "‮Delete\n", detail: "x\u0000y" }),
      policyContext(),
    );
    expect(approval).toEqual({
      ok: true,
      action: { op: "requestApproval", threadId: "thr_1", title: "Delete", detail: "xy" },
    });
    expect(
      decide(req("requestApproval", { threadId: "thr_1", title: "‮\u0000" }), policyContext()).ok,
    ).toBe(false);
  });

  test("post defaults to builtin extensions only", () => {
    expect(defaultAllowPost("builtin")).toBe(true);
    expect(defaultAllowPost("user")).toBe(false);
    expect(defaultAllowPost("project")).toBe(false);
  });
});

function build(answers: readonly ConfirmAnswer[], backend?: BridgeBackend) {
  const time = new ManualTime();
  const pair = portPair();
  const ledger = createScreenLedger();
  const fake = fakeBackend();
  const confirm = confirmer(answers);
  const closed: string[] = [];
  createBridgeHost({
    port: pair.host,
    screenKey: "helm/inquiry",
    context: () => policyContext(),
    backend: backend ?? fake.backend,
    ledger,
    clock: time,
    scheduler: time,
    confirm: confirm.confirm,
    onClosed: (reason) => closed.push(reason),
  });
  return { time, pair, ledger, confirm, closed, calls: fake.calls };
}

describe("confirm line failures", () => {
  test("denies count as ledger failures and the fifth consecutive one disables the screen", async () => {
    const { pair, ledger, time, closed } = build(["deny", "deny", "deny", "deny", "deny"]);
    await inOrder([0, 1, 2, 3, 4], async (index) => {
      pair.frame.send(request(index, "call", { verb: "start" }));
      await flush();
      // 연속 3번 거부 뒤 쉬는 시간을 흘려 줄이 다시 뜨게 한다
      time.advance(CONFIRM_COOLDOWN_MS);
    });
    expect(ledger.stateOf("helm/inquiry")).toEqual({
      state: "view_disabled",
      last: "confirm_denied",
    });
    expect(closed).toEqual(["confirm_denied"]);
  });

  test("three consecutive denies auto-deny without showing the line until the cooldown ends", async () => {
    const { pair, confirm, time } = build(["deny", "deny", "deny", "allow"]);
    await inOrder([1, 2, 3], async (index) => {
      pair.frame.send(request(index, "call", { verb: "start" }));
      await flush();
    });
    expect(confirm.asked.length).toBe(3);
    pair.frame.send(request(4, "call", { verb: "start" }));
    await flush();
    expect(confirm.asked.length).toBe(3);
    expect(pair.toFrame[3]).toEqual({
      v: 1,
      id: 4,
      ok: false,
      error: { kind: "denied", detail: "confirm_cooldown" },
    });
    time.advance(CONFIRM_COOLDOWN_MS);
    pair.frame.send(request(5, "call", { verb: "start" }));
    await flush();
    expect(confirm.asked.length).toBe(4);
    expect(pair.toFrame[4]).toEqual({ v: 1, id: 5, ok: true, value: { done: true } });
  });

  test("an allow resets the deny streak", async () => {
    const { pair, confirm } = build(["deny", "deny", "allow", "deny", "deny", "allow"]);
    await inOrder([1, 2, 3, 4, 5, 6], async (index) => {
      pair.frame.send(request(index, "call", { verb: "start" }));
      await flush();
    });
    expect(confirm.asked.length).toBe(6);
  });

  test("a timeout is counted as its own ledger failure", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const ledger = createScreenLedger();
    const { backend } = fakeBackend();
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger,
      clock: time,
      scheduler: time,
      confirm: () => new Promise<ConfirmAnswer>(() => {}),
      onClosed: () => {},
    });
    pair.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    time.advance(CONFIRM_TIMEOUT_MS);
    await flush();
    expect(pair.toFrame).toEqual([
      { v: 1, id: 1, ok: false, error: { kind: "denied", detail: "not_confirmed" } },
    ]);
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 1 });
  });

  test("the line shows the params summary of what will run, the trust and no frame-supplied label", async () => {
    const { pair, confirm } = build(["allow"]);
    pair.frame.send(request(1, "call", { verb: "start", params: { b: 2, a: "x‮y" } }));
    await flush();
    expect(confirm.asked).toEqual([
      {
        extension: "helm",
        trust: "user",
        action: "start",
        label: undefined,
        paramsSummary: 'a="xy", b=2',
        approval: false,
      },
    ]);
  });

  test("a manifest label reaches the line", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const { backend } = fakeBackend();
    const confirm = confirmer(["allow"]);
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () =>
        policyContext({
          methods: new Map([["start", { readOnly: false, approval: false, label: "Start work" }]]),
        }),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: confirm.confirm,
      onClosed: () => {},
    });
    pair.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    expect(confirm.asked[0]?.label).toBe("Start work");
  });

  test("params summary is capped and sorted", () => {
    expect(summarizeParams({})).toBe("");
    expect(summarizeParams({ z: 1, a: [1, 2] })).toBe("a=[1,2], z=1");
    expect(summarizeParams({ big: "x".repeat(500) }).length).toBe(161);
  });
});

describe("settings, budgets and limits", () => {
  test("only manifest-declared keys return values, undeclared keys return status only", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const { backend } = fakeBackend({
      settings: [
        { key: "ext.helm.depth", secret: false, isSet: true, value: 3 },
        { key: "ext.helm.hidden", secret: false, isSet: true, value: "private" },
        { key: "ext.helm.none", secret: false, isSet: false, value: undefined },
      ],
    });
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: () => Promise.resolve("deny"),
      onClosed: () => {},
    });
    pair.frame.send(
      request(1, "settings", {
        keys: ["ext.helm.depth", "ext.helm.hidden", "ext.helm.none"],
      }),
    );
    await flush();
    expect(pair.toFrame).toEqual([
      {
        v: 1,
        id: 1,
        ok: true,
        value: [
          { key: "ext.helm.depth", value: 3 },
          { key: "ext.helm.hidden", status: "set" },
          { key: "ext.helm.none", status: "unset" },
        ],
      },
    ]);
  });

  test("post and requestApproval are limited to one per 5 s", async () => {
    const { pair, time, ledger } = build(["deny"]);
    pair.frame.send(request(1, "post", { threadId: "thr_1", text: "a" }));
    pair.frame.send(request(2, "requestApproval", { threadId: "thr_1", title: "b" }));
    await flush();
    expect(pair.toFrame).toEqual([
      { v: 1, id: 2, ok: false, error: { kind: "rate_limited" } },
      { v: 1, id: 1, ok: true, value: null },
    ]);
    // 거절은 한 번 셌지만 뒤이어 끝난 post가 일을 한 성공이라 연속 횟수를 되돌렸다
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 0 });
    time.advance(POST_MIN_INTERVAL_MS);
    pair.frame.send(request(3, "post", { threadId: "thr_1", text: "c" }));
    await flush();
    expect(pair.toFrame.at(-1)).toEqual({ v: 1, id: 3, ok: true, value: null });
  });

  test("at most five post or approval requests can be outstanding", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const fake = fakeBackend();
    let pending = 0;
    const backend: BridgeBackend = {
      ...fake.backend,
      requestApproval() {
        pending += 1;
        return new Promise(() => {});
      },
    };
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: () => Promise.resolve("deny"),
      onClosed: () => {},
    });
    await inOrder([1, 2, 3, 4, 5, 6, 7], async (index) => {
      pair.frame.send(request(index, "requestApproval", { threadId: "thr_1", title: "t" }));
      await flush();
      time.advance(POST_MIN_INTERVAL_MS);
    });
    expect(pending).toBe(5);
    expect(pair.toFrame).toEqual([
      { v: 1, id: 6, ok: false, error: { kind: "rate_limited" } },
      { v: 1, id: 7, ok: false, error: { kind: "rate_limited" } },
    ]);
  });

  test("more than eight queries in flight are refused", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const fake = fakeBackend();
    let started = 0;
    const backend: BridgeBackend = {
      ...fake.backend,
      query() {
        started += 1;
        return new Promise(() => {});
      },
    };
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: () => Promise.resolve("deny"),
      onClosed: () => {},
    });
    for (let index = 1; index <= 10; index += 1) {
      pair.frame.send(request(index, "query", { verb: "status" }));
    }
    await flush();
    expect(started).toBe(8);
    expect(pair.toFrame).toEqual([
      { v: 1, id: 9, ok: false, error: { kind: "rate_limited", detail: "query_inflight" } },
      { v: 1, id: 10, ok: false, error: { kind: "rate_limited", detail: "query_inflight" } },
    ]);
  });

  test("__proto__ in params is data: it reaches the backend as an own key and pollutes nothing", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const fake = fakeBackend();
    const seen: { own: boolean; polluted: boolean; value: unknown }[] = [];
    const backend: BridgeBackend = {
      ...fake.backend,
      query(_verb, params) {
        seen.push({
          own: Object.hasOwn(params, "__proto__"),
          polluted: "injected" in {},
          value: Object.getOwnPropertyDescriptor(params, "__proto__")?.value,
        });
        return Promise.resolve({ ok: true, value: null });
      },
    };
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: () => Promise.resolve("deny"),
      onClosed: () => {},
    });
    const message: unknown = JSON.parse(
      '{"v":1,"id":1,"op":"query","args":{"verb":"status","params":{"__proto__":{"injected":true}}}}',
    );
    pair.frame.send(message);
    await flush();
    expect(seen).toEqual([{ own: true, polluted: false, value: { injected: true } }]);
    expect("injected" in {}).toBe(false);
  });
});
