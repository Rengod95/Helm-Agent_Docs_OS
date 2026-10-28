import { describe, expect, test } from "bun:test";
import { providerSecretName } from "../../src/settings/index.ts";
import { evt, STORE, summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 데스크톱 명령이 wire 오류와 결과를 화면 상태로 바꾸는 흐름을 가짜 셸과 가짜 엔진 위에서 끝까지 돌린다.

const LOCKED = {
  code: 3002,
  kind: "thread.locked",
  details: { ownerKind: "cli", options: ["observe", "fork", "delegate"] },
};

async function liveApp(extra: Parameters<typeof engineFake>[2]) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

describe("thread.locked", () => {
  test("a refused turn.start opens the dialog with the owner and the options this screen draws", async () => {
    const { app } = await liveApp({ errors: { "turn.start": LOCKED } });
    const sent = await app.commands.sendTurn(thr(1), "hi", "req-1");
    expect(sent).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe", "fork"] },
    });
    expect(app.ui.read.getState().locked).toEqual({
      threadId: thr(1),
      ownerKind: "cli",
      options: ["observe", "fork"],
    });
    await app.stop();
  });

  test("observing opens the thread in observe mode, closes the dialog and locks the composer flag", async () => {
    const { app, params } = await liveApp({
      errors: { "turn.start": LOCKED },
      results: {
        "thread.open": { threadId: thr(1), role: "observer", position: { storeId: STORE, seq: 5 } },
      },
    });
    await app.commands.sendTurn(thr(1), "hi", "req-1");
    const observed = await app.commands.observeThread(thr(1));
    expect(observed.ok).toBe(true);
    expect(params.find((p) => p.method === "thread.open")?.params).toEqual({
      threadId: thr(1),
      mode: "observe",
    });
    expect(app.ui.read.getState().locked).toBeNull();
    expect(app.ui.read.getState().observing).toEqual({ [thr(1)]: true });
    app.commands.retryWrite(thr(1));
    expect(app.ui.read.getState().observing).toEqual({});
    await app.stop();
  });

  test("forking selects the new thread and closes the dialog", async () => {
    const { app, params } = await liveApp({
      errors: { "turn.start": LOCKED },
      results: { "thread.fork": { threadId: thr(2), position: { storeId: STORE, seq: 6 } } },
    });
    await app.commands.sendTurn(thr(1), "hi", "req-1");
    const forked = await app.commands.forkThread(thr(1));
    expect(forked.ok).toBe(true);
    expect(params.find((p) => p.method === "thread.fork")?.params).toEqual({ threadId: thr(1) });
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    expect(app.ui.read.getState().locked).toBeNull();
    await app.stop();
  });

  test("a successful turn.start clears a stale observing flag", async () => {
    const { app } = await liveApp({});
    app.ui.actions.setObserving(thr(1), true);
    expect((await app.commands.sendTurn(thr(1), "hi", "req-1")).ok).toBe(true);
    expect(app.ui.read.getState().observing).toEqual({});
    await app.stop();
  });
});

describe("trust wire", () => {
  const status = {
    projectRoot: "/work/repo",
    required: true,
    verdict: "undecided",
    via: "default",
    resources: [".mcp.json"],
    options: [],
  };

  test("status and decide send the workspace and return the host's verdict", async () => {
    const { app, params } = await liveApp({
      results: {
        "trust.get": status,
        "trust.decide": { ...status, verdict: "allow", via: "store" },
      },
    });
    const got = await app.commands.trust.status("/work/repo");
    expect(got.ok && got.value.verdict).toBe("undecided");
    const decided = await app.commands.trust.decide("/work/repo", {
      kind: "folder",
      verdict: "allow",
    });
    expect(decided.ok && decided.value.verdict).toBe("allow");
    expect(params.filter((p) => p.method.startsWith("trust."))).toEqual([
      { method: "trust.get", params: { workspace: "/work/repo" } },
      {
        method: "trust.decide",
        params: { workspace: "/work/repo", choice: { kind: "folder", verdict: "allow" } },
      },
    ]);
    await app.stop();
  });

  test("a host without trust.get reports unsupported, so no card is drawn", async () => {
    const { app } = await liveApp({
      errors: { "trust.get": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.trust.status("/work/repo")).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});

describe("approval.respond reasons", () => {
  test("answer_invalid keeps the host's detail on the card state", async () => {
    const { app } = await liveApp({
      results: {
        "approval.respond": {
          applied: false,
          reason: "answer_invalid",
          detail: "q1: unknown option",
        },
      },
    });
    await app.commands.respondApproval(evt(7), {
      decision: "answer",
      answer: { q1: { selected: ["zz"] } },
    });
    const state = app.ui.read.getState();
    expect(state.approvalSends[evt(7)]).toBe("invalid");
    expect(state.approvalDetails[evt(7)]).toBe("q1: unknown option");
    await app.stop();
  });
});

const setting = (key: string, value: unknown) => ({
  key,
  value,
  source: { scope: "user" },
  locked: false,
  shadowed: [],
  runtimeChange: "live",
  pendingUntil: null,
  deprecated: false,
});

describe("settings screen wire", () => {
  const providers = [
    { id: "openai", enabled: false, apiKeyRef: null, baseUrl: "http://proxy.local" },
  ];

  test("load reads the model keys and the secret list and never asks for a value", async () => {
    const { app, params } = await liveApp({
      results: {
        "settings.get": {
          settings: [
            setting("l1.models.default", "anthropic/claude-sonnet-5-5"),
            setting("l1.models.providers", providers),
          ],
        },
        "secret.list": {
          secrets: [
            { name: "anthropic-api-key", status: "valid" },
            { name: "old-key", status: "expired" },
          ],
        },
      },
    });
    const loaded = await app.commands.setup.load({ binaries: false });
    if (!loaded.ok) throw new Error("load failed");
    expect(loaded.value).toEqual({
      providers,
      defaultModel: "anthropic/claude-sonnet-5-5",
      secrets: [
        { name: "anthropic-api-key", registered: true },
        { name: "old-key", registered: false },
      ],
      toolsReady: null,
      binaries: null,
    });
    expect(params.find((p) => p.method === "settings.get")?.params).toEqual({
      keys: ["l1.models.default", "l1.models.providers"],
    });
    // 점검을 청하지 않은 읽기(시작 안내 띠, 설정 알림 뒤의 다시 읽기)는 자식 프로세스를 띄우는 점검을 일으키지 않는다
    expect(params.some((p) => p.method === "host.status")).toBe(false);
    await app.stop();
  });

  const HOST_STATUS = {
    mode: "stdio",
    pid: 4242,
    startedAt: "2026-10-26T00:00:00.000Z",
    connections: 1,
    liveTurns: 0,
    idleShutdownAt: null,
  };

  test("load with binaries asks host.status for the check and shows the report from the wire (G2-07)", async () => {
    const { app, params } = await liveApp({
      results: {
        "settings.get": { settings: [] },
        "host.status": {
          ...HOST_STATUS,
          binaries: {
            platform: "darwin",
            ready: false,
            blocking: ["sops"],
            degraded: ["socat"],
            items: [
              {
                name: "sops",
                need: "required",
                usedBy: "비밀 저장소",
                impact: "키를 저장할 수 없다",
                status: { kind: "missing", hint: "brew install sops" },
              },
              {
                name: "rg",
                need: "required",
                usedBy: "검색",
                impact: "검색 불가",
                status: { kind: "ok", version: "14.1.0", source: "bundled" },
              },
            ],
          },
        },
      },
    });
    const loaded = await app.commands.setup.load({ binaries: true });
    if (!loaded.ok) throw new Error("load failed");
    expect(params.find((p) => p.method === "host.status")?.params).toEqual({
      includeBinaries: true,
    });
    expect(loaded.value.toolsReady).toBe(false);
    expect(loaded.value.binaries).toEqual({
      platform: "darwin",
      ready: false,
      rows: [
        {
          name: "sops",
          need: "required",
          usedBy: "비밀 저장소",
          ok: false,
          note: "brew install sops",
          impact: "키를 저장할 수 없다",
        },
        {
          name: "rg",
          need: "required",
          usedBy: "검색",
          ok: true,
          note: "14.1.0",
          impact: "검색 불가",
        },
      ],
    });
    await app.stop();
  });

  test("a host.status without binaries, an old host and a cancelled check all leave the tools unknown", async () => {
    const without = await liveApp({
      results: { "settings.get": { settings: [] }, "host.status": HOST_STATUS },
    });
    const a = await without.app.commands.setup.load({ binaries: true });
    expect(a.ok && [a.value.binaries, a.value.toolsReady]).toEqual([null, null]);
    await without.app.stop();

    const oldHost = await liveApp({
      errors: { "host.status": { code: -32601, kind: "jsonrpc.methodNotFound" } },
      results: { "settings.get": { settings: [] } },
    });
    const b = await oldHost.app.commands.setup.load({ binaries: true });
    expect(b.ok && [b.value.binaries, b.value.toolsReady]).toEqual([null, null]);
    await oldHost.app.stop();

    const cancelled = await liveApp({
      errors: { "host.status": { code: 5001, kind: "request.cancelled" } },
      results: { "settings.get": { settings: [] } },
    });
    const c = await cancelled.app.commands.setup.load({ binaries: true });
    // 점검이 취소되어도 설정은 읽힌다. 부분 결과는 없다
    expect(c.ok && [c.value.binaries, c.value.toolsReady]).toEqual([null, null]);
    await cancelled.app.stop();
  });

  test("connectProviderKey rewrites only the matching provider in the user scope", async () => {
    const { app, params } = await liveApp({
      results: {
        "settings.get": { settings: [setting("l1.models.providers", providers)] },
        "settings.set": { setting: setting("l1.models.providers", []) },
      },
    });
    const name = providerSecretName("openai");
    if (!name.ok) throw new Error("fixture");
    const done = await app.commands.setup.connectProviderKey("openai", name.value);
    expect(done.ok).toBe(true);
    expect(params.find((p) => p.method === "settings.set")?.params).toEqual({
      key: "l1.models.providers",
      value: [
        {
          id: "openai",
          enabled: true,
          apiKeyRef: "secret://openai-api-key",
          baseUrl: "http://proxy.local",
        },
      ],
      scope: "user",
    });
    await app.stop();
  });

  test("setDefaultModel writes the user scope; beginKeyEntry sends the name and action only", async () => {
    const { app, params } = await liveApp({
      results: {
        "secret.beginEntry": { started: false },
        "settings.set": { setting: setting("l1.models.default", null) },
      },
    });
    expect((await app.commands.setup.setDefaultModel("anthropic/claude-sonnet-5-5")).ok).toBe(true);
    const name = providerSecretName("anthropic");
    if (!name.ok) throw new Error("fixture");
    const begun = await app.commands.setup.beginKeyEntry(name.value, "add");
    expect(begun).toEqual({ ok: true, value: false });
    expect(params.find((p) => p.method === "settings.set")?.params).toEqual({
      key: "l1.models.default",
      value: "anthropic/claude-sonnet-5-5",
      scope: "user",
    });
    expect(params.find((p) => p.method === "secret.beginEntry")?.params).toEqual({
      name: "anthropic-api-key",
      action: "add",
    });
    await app.stop();
  });

  test("a secret.* error kind from the host surfaces as a rejection with its code", async () => {
    const { app } = await liveApp({
      errors: { "secret.list": { code: 3201, kind: "secret.notFound" } },
      results: { "settings.get": { settings: [] } },
    });
    const loaded = await app.commands.setup.load({ binaries: false });
    // 비밀 목록을 읽지 못해도 설정 화면은 뜬다. 키 단계는 "확인할 수 없음"이다
    expect(loaded.ok && loaded.value.secrets).toBeNull();
    await app.stop();
  });

  test("settings.invalidated for model keys wakes the listener, other keys do not", async () => {
    const { app, fake } = await liveApp({});
    let woke = 0;
    const stop = app.commands.setup.onInvalidated(() => void (woke += 1));
    const send = (keys: string[]): void =>
      fake.emitLine({
        jsonrpc: "2.0",
        method: "settings.invalidated",
        params: { keys, scopes: ["user"], threadId: null },
      });
    send(["l4.cli.theme"]);
    send(["l1.models.default"]);
    send([]);
    await until(() => woke === 2, "two wake-ups");
    stop();
    send(["l1.models.default"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(woke).toBe(2);
    await app.stop();
  });
});

describe("new thread workspace (G2-02)", () => {
  const CREATED = { "thread.create": { threadId: thr(2), position: { storeId: STORE, seq: 6 } } };

  test("the chosen folder is sent as thread.create workspace and the new thread is selected", async () => {
    const { app, params } = await liveApp({ results: CREATED });
    const created = await app.commands.createThread("/Users/me/project");
    expect(created.ok).toBe(true);
    expect(params.find((p) => p.method === "thread.create")?.params).toEqual({
      workspace: "/Users/me/project",
    });
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    await app.stop();
  });

  test("without a folder the request carries no workspace key", async () => {
    const { app, params } = await liveApp({ results: CREATED });
    await app.commands.createThread();
    expect(params.find((p) => p.method === "thread.create")?.params).toEqual({});
    await app.stop();
  });

  test("a folder the host refuses (-32602) is a rejection with its code and no thread is selected", async () => {
    const { app } = await liveApp({
      errors: { "thread.create": { code: -32602, kind: "jsonrpc.invalidParams" } },
    });
    const created = await app.commands.createThread("/no/such/folder");
    expect(created).toEqual({ ok: false, error: { kind: "rejected", code: -32602 } });
    expect(app.ui.read.getState().selectedThreadId).toBeNull();
    await app.stop();
  });
});
