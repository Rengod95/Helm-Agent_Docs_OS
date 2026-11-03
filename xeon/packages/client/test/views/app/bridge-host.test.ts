import { describe, expect, test } from "bun:test";
import { createScreenLedger } from "../../../src/views/ledger.ts";
import {
  createBridgeHost,
  createConfirmMemory,
  LIVENESS_INTERVAL_MS,
  type BridgePolicyContext,
  type ConfirmAnswer,
  type SettingRead,
} from "../../../src/views/app/index.ts";
import {
  confirmer,
  fakeBackend,
  flush,
  ManualTime,
  policyContext,
  portPair,
  request,
  type FakeBackendOptions,
} from "./support.ts";

function setup(
  options: {
    context?: () => BridgePolicyContext;
    backend?: FakeBackendOptions;
    answers?: readonly ConfirmAnswer[];
  } = {},
) {
  const time = new ManualTime();
  const pair = portPair();
  const ledger = createScreenLedger();
  const { backend, calls } = fakeBackend(options.backend);
  const confirm = confirmer(options.answers ?? ["allow"]);
  const closed: string[] = [];
  const memory = createConfirmMemory();
  const host = createBridgeHost({
    port: pair.host,
    screenKey: "helm/inquiry",
    context: options.context ?? (() => policyContext()),
    backend,
    ledger,
    clock: time,
    scheduler: time,
    confirm: confirm.confirm,
    confirmMemory: memory,
    onClosed: (reason) => closed.push(reason),
  });
  return { time, pair, ledger, calls, confirm, closed, host, memory };
}

describe("bridge host", () => {
  test("a declared query returns the backend value for the same id", async () => {
    const { pair } = setup();
    pair.frame.send(request(7, "query", { verb: "status" }));
    await flush();
    expect(pair.toFrame).toEqual([{ v: 1, id: 7, ok: true, value: { phase: "idle" } }]);
  });

  test("denied ops answer with the policy error and call no backend method", async () => {
    const { pair, calls } = setup();
    pair.frame.send(request(1, "query", { verb: "nope" }));
    pair.frame.send(request(2, "command", { name: "model" }));
    await flush();
    expect(pair.toFrame).toEqual([
      { v: 1, id: 1, ok: false, error: { kind: "not_declared" } },
      { v: 1, id: 2, ok: false, error: { kind: "not_declared", detail: "command" } },
    ]);
    expect(calls.names).toEqual([]);
  });

  test("secret settings never carry their value across, only set or unset", async () => {
    const sentinel = "sk-SENTINEL-0123456789";
    const rows: SettingRead[] = [
      { key: "ext.helm.apiKey", secret: true, isSet: true, value: sentinel },
      { key: "ext.helm.empty", secret: true, isSet: false, value: sentinel },
      { key: "ext.helm.depth", secret: false, isSet: true, value: 3 },
    ];
    const { pair } = setup({ backend: { settings: rows } });
    pair.frame.send(
      request(1, "settings", { keys: ["ext.helm.apiKey", "ext.helm.empty", "ext.helm.depth"] }),
    );
    await flush();
    expect(pair.toFrame).toEqual([
      {
        v: 1,
        id: 1,
        ok: true,
        value: [
          { key: "ext.helm.apiKey", status: "set" },
          { key: "ext.helm.empty", status: "unset" },
          { key: "ext.helm.depth", value: 3 },
        ],
      },
    ]);
    expect(JSON.stringify(pair.toFrame)).not.toContain(sentinel);
  });

  test("host snapshot is copied field by field", async () => {
    const { pair } = setup();
    pair.frame.send(request(1, "host", {}));
    await flush();
    expect(pair.toFrame).toEqual([
      {
        v: 1,
        id: 1,
        ok: true,
        value: {
          threadId: "thr_1",
          threadTitle: "title",
          connection: "connected",
          locale: "ko",
          theme: "dark",
          extension: { enabled: true, trust: "user", safeMode: false },
        },
      },
    ]);
  });

  test("call asks the confirmation line first and runs only on allow", async () => {
    const allowed = setup({ answers: ["allow"] });
    allowed.pair.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    expect(allowed.confirm.asked).toEqual([
      { extension: "helm", action: "start", approval: false },
    ]);
    expect(allowed.calls.names).toEqual(["call:start"]);
    expect(allowed.pair.toFrame).toEqual([{ v: 1, id: 1, ok: true, value: { done: true } }]);

    const denied = setup({ answers: ["deny"] });
    denied.pair.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    expect(denied.calls.names).toEqual([]);
    expect(denied.pair.toFrame).toEqual([
      { v: 1, id: 1, ok: false, error: { kind: "denied", detail: "not_confirmed" } },
    ]);
  });

  test("a frame cannot supply the confirmation label: unknown fields are rejected", async () => {
    const { pair, calls, confirm } = setup();
    pair.frame.send(request(1, "call", { verb: "start", label: "Save your file" }));
    await flush();
    expect(confirm.asked).toEqual([]);
    expect(calls.names).toEqual([]);
    expect(pair.toFrame).toEqual([
      { v: 1, id: 1, ok: false, error: { kind: "args_invalid", detail: "/label boolean" } },
    ]);
  });

  test("command is confirmed like call, with the slash name as the action", async () => {
    const { pair, confirm, calls } = setup();
    pair.frame.send(request(1, "command", { name: "helm-start", args: "go" }));
    await flush();
    expect(confirm.asked).toEqual([{ extension: "helm", action: "/helm-start", approval: false }]);
    expect(calls.names).toEqual(["command:helm-start:go"]);
  });

  test("allow_always silences the line for that extension, shared through the memory", async () => {
    const { pair, confirm, calls, memory } = setup({ answers: ["allow_always"] });
    pair.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    pair.frame.send(request(2, "call", { verb: "wipe" }));
    await flush();
    expect(confirm.asked).toEqual([{ extension: "helm", action: "start", approval: false }]);
    expect(calls.names).toEqual(["call:start", "call:wipe"]);
    expect(memory.isSuppressed("helm")).toBe(true);
    expect(memory.isSuppressed("other")).toBe(false);
  });

  test("only one confirmation can be pending, a second call is denied at once", async () => {
    const time = new ManualTime();
    const pair = portPair();
    const { backend, calls } = fakeBackend();
    let release: ((answer: ConfirmAnswer) => void) | undefined;
    const asked: string[] = [];
    createBridgeHost({
      port: pair.host,
      screenKey: "helm/inquiry",
      context: () => policyContext(),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: (request) => {
        asked.push(request.action);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      confirmMemory: createConfirmMemory(),
      onClosed: () => {},
    });
    pair.frame.send(request(1, "call", { verb: "start" }));
    pair.frame.send(request(2, "call", { verb: "start" }));
    await flush();
    expect(pair.toFrame).toEqual([
      { v: 1, id: 2, ok: false, error: { kind: "denied", detail: "not_confirmed" } },
    ]);
    release?.("allow");
    await flush();
    expect(asked).toEqual(["start"]);
    expect(calls.names).toEqual(["call:start"]);
    expect(pair.toFrame[1]).toEqual({ v: 1, id: 1, ok: true, value: { done: true } });
  });

  test("extension turned off while the line is open stops the call", async () => {
    let enabled = true;
    const { pair, calls } = setup({ context: () => policyContext({ enabled }) });
    // 확인 응답 안에서 상태를 끈다
    const time = new ManualTime();
    const pair2 = portPair();
    const { backend, calls: calls2 } = fakeBackend();
    createBridgeHost({
      port: pair2.host,
      screenKey: "helm/inquiry",
      context: () => policyContext({ enabled }),
      backend,
      ledger: createScreenLedger(),
      clock: time,
      scheduler: time,
      confirm: () => {
        enabled = false;
        return Promise.resolve("allow");
      },
      confirmMemory: createConfirmMemory(),
      onClosed: () => {},
    });
    pair2.frame.send(request(1, "call", { verb: "start" }));
    await flush();
    expect(calls2.names).toEqual([]);
    expect(pair2.toFrame).toEqual([{ v: 1, id: 1, ok: false, error: { kind: "extension_off" } }]);
    expect(pair.toFrame).toEqual([]);
    expect(calls.names).toEqual([]);
  });

  test("external links need the shell's own confirmation", async () => {
    const blocked = setup({ backend: { externalAllowed: false } });
    blocked.pair.frame.send(
      request(1, "navigate", { target: { kind: "external", url: "https://example.com" } }),
    );
    await flush();
    expect(blocked.pair.toFrame).toEqual([
      { v: 1, id: 1, ok: false, error: { kind: "denied", detail: "not_confirmed" } },
    ]);
    expect(blocked.calls.navigations).toEqual([]);
    const allowed = setup();
    allowed.pair.frame.send(
      request(1, "navigate", { target: { kind: "external", url: "https://example.com" } }),
    );
    await flush();
    expect(allowed.calls.navigations).toEqual([
      { target: { kind: "external", url: "https://example.com" }, shellConfirmed: true },
    ]);
  });

  test("log keeps op and size only, resize reaches the shell", async () => {
    const { pair, calls } = setup();
    pair.frame.send(request(1, "log", { message: "hello" }));
    pair.frame.send(request(2, "resize", { height: 240 }));
    await flush();
    expect(calls.diagnostics).toEqual([{ op: "log", size: 5 }]);
    expect(calls.resizes).toEqual([240]);
  });

  test("a message over 1 MiB is refused and counted", async () => {
    const { pair, ledger } = setup();
    pair.frame.send(
      request(3, "query", { verb: "status", params: { blob: "x".repeat(1_048_577) } }),
    );
    await flush();
    expect(pair.toFrame).toEqual([{ v: 1, id: 3, ok: false, error: { kind: "too_large" } }]);
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 1 });
  });

  test("a query result over 256 KiB is refused", async () => {
    const { pair, ledger } = setup({
      backend: { queryResult: { ok: true, value: { big: "x".repeat(262_200) } } },
    });
    pair.frame.send(request(1, "query", { verb: "status" }));
    await flush();
    expect(pair.toFrame).toEqual([{ v: 1, id: 1, ok: false, error: { kind: "too_large" } }]);
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 1 });
  });

  test("the 51st message inside one second is rate limited, the next second starts fresh", async () => {
    const { pair, time } = setup();
    for (let id = 1; id <= 51; id += 1) pair.frame.send(request(id, "host", {}));
    await flush();
    expect(pair.toFrame.length).toBe(51);
    // 거부는 바로 답하고 나머지는 판정 뒤에 답하므로 순서가 아니라 id로 찾는다
    expect(
      pair.toFrame.find((message) => Object.getOwnPropertyDescriptor(message, "id")?.value === 51),
    ).toEqual({
      v: 1,
      id: 51,
      ok: false,
      error: { kind: "rate_limited" },
    });
    time.advance(1000);
    pair.frame.send(request(100, "host", {}));
    await flush();
    expect(pair.toFrame.at(-1)).toMatchObject({ id: 100, ok: true });
  });

  test("malformed messages are counted, the fifth consecutive one closes the frame", async () => {
    const { pair, ledger, closed } = setup();
    for (let index = 0; index < 5; index += 1)
      pair.frame.send({ v: 2, id: index, op: "query", args: {} });
    await flush();
    expect(ledger.stateOf("helm/inquiry")).toEqual({
      state: "view_disabled",
      last: "bridge_format",
    });
    expect(closed).toEqual(["bridge_format"]);
    expect(pair.closedByHost()).toBe(true);
    const before = pair.toFrame.length;
    pair.frame.send(request(9, "host", {}));
    await flush();
    expect(pair.toFrame.length).toBe(before);
  });

  test("a good request resets the consecutive count", async () => {
    const { pair, ledger } = setup();
    for (let index = 0; index < 4; index += 1) pair.frame.send({ nope: true });
    pair.frame.send(request(1, "host", {}));
    await flush();
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 0 });
  });

  test("liveness: ping every 5 s, a pong keeps it, two misses close the frame", async () => {
    const { pair, time, closed, ledger, host } = setup();
    host.startLiveness();
    expect(pair.toFrame).toEqual([{ v: 1, push: "ping", value: { n: 1 } }]);
    pair.frame.send(request(1, "pong", { n: 1 }));
    await flush();
    time.advance(LIVENESS_INTERVAL_MS);
    expect(pair.toFrame[1]).toEqual({ v: 1, push: "ping", value: { n: 2 } });
    // 답이 없다: 첫 번째 놓침
    time.advance(LIVENESS_INTERVAL_MS);
    expect(pair.toFrame[2]).toEqual({ v: 1, push: "ping", value: { n: 3 } });
    expect(closed).toEqual([]);
    // 두 번째 놓침
    time.advance(LIVENESS_INTERVAL_MS);
    expect(closed).toEqual(["liveness_lost"]);
    expect(ledger.stateOf("helm/inquiry")).toEqual({ state: "active", consecutive: 1 });
    expect(time.pending()).toBe(0);
  });

  test("a pong with the wrong number does not count as an answer", async () => {
    const { pair, time, closed, host } = setup();
    host.startLiveness();
    pair.frame.send(request(1, "pong", { n: 99 }));
    await flush();
    time.advance(LIVENESS_INTERVAL_MS);
    time.advance(LIVENESS_INTERVAL_MS);
    expect(closed).toEqual(["liveness_lost"]);
  });

  test("dispose closes the port, clears timers and reports disposed", () => {
    const { pair, time, closed, host } = setup();
    host.startLiveness();
    host.dispose();
    expect(closed).toEqual(["disposed"]);
    expect(pair.closedByHost()).toBe(true);
    expect(time.pending()).toBe(0);
    host.push("theme", {});
    expect(pair.toFrame.length).toBe(1);
  });

  test("pushes go out as v1 push messages", () => {
    const { pair, host } = setup();
    host.push("theme", { scheme: "dark" });
    expect(pair.toFrame).toEqual([{ v: 1, push: "theme", value: { scheme: "dark" } }]);
  });
});
