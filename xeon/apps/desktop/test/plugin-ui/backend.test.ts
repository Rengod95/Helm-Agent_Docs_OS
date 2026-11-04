import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { WireError } from "@fresnel/contracts/wire";
import type { BackendResult, BridgePolicyContext, HostSnapshot } from "@fresnel/client/views/app";
import type { HostConnection } from "@fresnel/contracts/wire";
import { createBridgeBackend, type BridgeBackendDeps } from "../../src/plugin-ui/backend.ts";
import { policyContextOf } from "../../src/plugin-ui/policy-context.ts";
import { fakeConnection, type ExtTable, type Table } from "../state/fake-connection.ts";
import { STORE, itm, thr, userItem } from "../state/helpers.ts";
import { extGetOf, uiEntryOf } from "./support.ts";

const OPEN = thr(1);

const snapshot: HostSnapshot = {
  threadId: undefined,
  threadTitle: "조사",
  connection: "connected",
  locale: "ko-KR",
  theme: "dark",
  extension: { enabled: true, trust: "user", safeMode: false },
};

function policyOf(): BridgePolicyContext {
  const built = policyContextOf({
    get: extGetOf(),
    entry: uiEntryOf(),
    openThreadId: OPEN,
    commands: [{ name: "helm", origin: "helm" }],
  });
  if (!built.ok) throw new Error("the fixture manifest must parse");
  return built.value;
}

function harness(
  table: Table,
  overrides: Partial<BridgeBackendDeps> = {},
  extTable: ExtTable = {},
) {
  const fake = fakeConnection(table, extTable);
  const navigated: unknown[] = [];
  const opened: string[] = [];
  const diagnostics: { op: string; size: number }[] = [];
  const resized: number[] = [];
  const deps: BridgeBackendDeps = {
    connection: () => fake.connection,
    extension: "helm",
    screen: "status",
    openThreadId: () => OPEN,
    policy: policyOf,
    snapshot: () => snapshot,
    navigate: (target) => {
      navigated.push(target);
      return target.kind !== "extension";
    },
    openExternal: (href) => {
      opened.push(href);
      return Promise.resolve();
    },
    resize: (height) => {
      resized.push(height);
    },
    diagnostic: (line) => {
      diagnostics.push(line);
    },
    ...overrides,
  };
  return {
    backend: createBridgeBackend(deps),
    calls: fake.calls,
    navigated,
    opened,
    diagnostics,
    resized,
  };
}

const refused = (detail: string): BackendResult<never> => ({
  ok: false,
  error: { kind: "failed", detail },
});

/** 엔진이 돌려주는 오류 하나. 원문 메시지는 다리로 가면 안 된다 */
function rejecting(kind: string, message: string) {
  return (): Promise<never> =>
    Promise.reject(new WireError(-32000, message, { kind, retryable: false }));
}

function setting(key: string, value: unknown) {
  return {
    key,
    value,
    source: { scope: "user" as const },
    locked: false,
    shadowed: [],
    runtimeChange: "live" as const,
    pendingUntil: null,
    deprecated: false,
  };
}

function def(key: string, secret: boolean) {
  return {
    key,
    type: { type: "string" },
    runtimeChange: "live" as const,
    layer: "L3" as const,
    allowedScopes: ["user" as const],
    since: "0.1.0",
    secret,
  };
}

function customItem(n: number, customType: string, text: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType,
      content: text,
      display: true,
      details: null,
      timestamp: 1,
    },
  };
}

describe("extension methods and approvals", () => {
  test("query sends ext.helm.<verb> with the open thread and returns the raw value", async () => {
    const h = harness({}, {}, { "ext.helm.status": () => Promise.resolve({ runs: 2 }) });
    expect(await h.backend.query("status", { limit: 1 })).toEqual({ ok: true, value: { runs: 2 } });
    expect(h.calls).toEqual([{ method: "ext.helm.status", params: { limit: 1, threadId: OPEN } }]);
  });

  test("a threadId the frame wrote is dropped and never reaches the wire", async () => {
    const h = harness(
      {},
      { openThreadId: () => undefined },
      { "ext.helm.save": () => Promise.resolve({}) },
    );
    await h.backend.call("save", { threadId: "thr_other", name: "a" });
    expect(h.calls).toEqual([{ method: "ext.helm.save", params: { name: "a" } }]);
  });

  test("a wire error becomes a bridge error name without the engine text", async () => {
    const h = harness(
      {},
      {},
      {
        "ext.helm.save": rejecting("ext.helm.off", "secret detail"),
        "ext.helm.status": rejecting("jsonrpc.invalidParams", "secret detail"),
      },
    );
    expect(await h.backend.call("save", {})).toEqual({
      ok: false,
      error: { kind: "extension_off" },
    });
    expect(await h.backend.query("status", {})).toEqual({
      ok: false,
      error: { kind: "args_invalid", detail: "params" },
    });
  });

  test("a method that needs approval is closed and sends nothing", async () => {
    const h = harness({}, {}, { "ext.helm.reset": () => Promise.resolve({}) });
    expect(await h.backend.call("reset", {})).toEqual({
      ok: false,
      error: { kind: "denied", detail: "approval_required" },
    });
    expect(h.calls).toEqual([]);
  });

  test("requestApproval opens the standard card through ext.ui.requestApproval with the open thread only", async () => {
    const h = harness({
      "ext.ui.requestApproval": () => Promise.resolve({ approvalId: "evt_1" }),
    });
    expect(await h.backend.requestApproval(OPEN, "reset", { force: true })).toEqual({
      ok: true,
      value: { approvalId: "evt_1" },
    });
    expect(h.calls).toEqual([
      {
        method: "ext.ui.requestApproval",
        params: {
          extension: "helm",
          ui: "status",
          threadId: OPEN,
          method: "reset",
          params: { force: true },
        },
      },
    ]);
  });

  test("requestApproval for a thread that is not the open one sends nothing", async () => {
    const h = harness({});
    expect(await h.backend.requestApproval(thr(9), "reset", {})).toEqual({
      ok: false,
      error: { kind: "denied", detail: "thread_not_open" },
    });
    expect(h.calls).toEqual([]);
  });
});

describe("command", () => {
  test("runs the slash line on the open thread and maps a done result", async () => {
    const h = harness({
      "command.run": () =>
        Promise.resolve({ status: "done", name: "helm", message: "시작", result: { ok: true } }),
    });
    expect(await h.backend.command("helm", "  status  ")).toEqual({
      ok: true,
      value: { name: "helm", message: "시작", result: { ok: true } },
    });
    expect(h.calls).toEqual([
      { method: "command.run", params: { threadId: OPEN, text: "/helm status" } },
    ]);
  });

  test("no argument sends the bare name", async () => {
    const h = harness({
      "command.run": () =>
        Promise.resolve({ status: "done", name: "helm", message: null, result: null }),
    });
    await h.backend.command("helm", "");
    expect(h.calls[0]?.params).toEqual({ threadId: OPEN, text: "/helm" });
  });

  test("a shell-injection confirmation is never answered by this bridge", async () => {
    const h = harness({
      "command.run": () =>
        Promise.resolve({ status: "needs_confirmation", name: "helm", shell: [] }),
    });
    expect(await h.backend.command("helm", "x")).toEqual({
      ok: false,
      error: { kind: "denied", detail: "shell_confirm" },
    });
  });

  test("an expanded template is not sent as a turn from here", async () => {
    const h = harness({
      "command.run": () => Promise.resolve({ status: "expanded", name: "helm", text: "본문" }),
    });
    expect(await h.backend.command("helm", "")).toEqual(refused("command_expanded"));
  });

  test("with no open thread the command is refused before any wire call", async () => {
    const h = harness({}, { openThreadId: () => undefined });
    expect(await h.backend.command("helm", "")).toEqual({
      ok: false,
      error: { kind: "denied", detail: "thread_not_open" },
    });
    expect(h.calls).toEqual([]);
  });
});

describe("post", () => {
  test("sends ext.ui.post with this screen, the open thread and the text", async () => {
    const h = harness({
      "ext.ui.post": () => Promise.resolve({ accepted: true }),
    });
    expect(await h.backend.post(OPEN, "안녕")).toEqual({ ok: true, value: { accepted: true } });
    expect(h.calls).toEqual([
      {
        method: "ext.ui.post",
        params: {
          extension: "helm",
          ui: "status",
          threadId: OPEN,
          name: "message",
          payload: "안녕",
        },
      },
    ]);
  });
});

describe("settings", () => {
  const table: Table = {
    "settings.list": () =>
      Promise.resolve({
        defs: [
          def("ext.helm.model", false),
          def("ext.helm.token", true),
          def("ext.helm.hidden", false),
        ],
      }),
    "settings.get": () =>
      Promise.resolve({
        settings: [
          setting("ext.helm.model", "gpt-x"),
          setting("ext.helm.token", "secret://helm-token"),
          setting("ext.helm.hidden", "not declared"),
        ],
      }),
  };

  test("declared plain values are shown, secrets only report whether they are set", async () => {
    const h = harness(table);
    const result = await h.backend.settings([
      "ext.helm.model",
      "ext.helm.token",
      "ext.helm.hidden",
      "ext.helm.absent",
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { key: "ext.helm.model", secret: false, isSet: true, value: "gpt-x" },
        { key: "ext.helm.token", secret: true, isSet: true, value: undefined },
        { key: "ext.helm.hidden", secret: false, isSet: true, value: undefined },
        // 정의가 없는 키는 비밀로 본다(닫힌 쪽)
        { key: "ext.helm.absent", secret: true, isSet: false, value: undefined },
      ],
    });
  });

  test("a secret reference never appears anywhere in the result", async () => {
    const h = harness(table);
    const result = await h.backend.settings(["ext.helm.token"]);
    expect(JSON.stringify(result)).not.toContain("secret://");
    expect(JSON.stringify(result)).not.toContain("helm-token");
  });

  test("reads the definitions and the values for the open thread", async () => {
    const h = harness(table);
    await h.backend.settings(["ext.helm.model"]);
    expect(h.calls.map((call) => call.method)).toEqual(["settings.list", "settings.get"]);
    expect(h.calls[1]?.params).toEqual({ keys: ["ext.helm.model"], threadId: OPEN });
  });
});

describe("events", () => {
  const items: ItemRecord[] = [
    userItem(1, "사용자 글"),
    customItem(2, "x.helm.ui.note", "own"),
    customItem(3, "x.other.secret.item", "other extension, not declared"),
    customItem(4, "x.other.note.item", "declared read"),
    customItem(5, "x.helm.ui.other", "own, not asked for"),
  ];
  const table: Table = {
    "thread.read": () =>
      Promise.resolve({
        threadId: OPEN,
        items,
        position: { storeId: STORE, seq: 5 },
        hasMore: false,
      }),
  };

  test("keeps only the requested kinds the extension may read, from the open thread", async () => {
    const h = harness(table);
    const result = await h.backend.events(
      ["x.helm.ui.note", "x.other.secret.item", "x.other.note.item"],
      10,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          kind: "x.helm.ui.note",
          itemId: itm(2),
          timestamp: 1,
          display: true,
          content: "own",
          details: null,
        },
        {
          kind: "x.other.note.item",
          itemId: itm(4),
          timestamp: 1,
          display: true,
          content: "declared read",
          details: null,
        },
      ],
    });
    expect(h.calls).toEqual([{ method: "thread.read", params: { threadId: OPEN, limit: 10 } }]);
  });

  test("core kinds have no items on this path, so they come back empty", async () => {
    const h = harness(table);
    expect(await h.backend.events(["turn.started"], 10)).toEqual({ ok: true, value: [] });
  });

  test("the row count is capped by limit and the read is capped at 500", async () => {
    const h = harness(table);
    const one = await h.backend.events(["x.helm.ui.note", "x.other.note.item"], 1);
    expect(one).toEqual({ ok: true, value: [expect.objectContaining({ kind: "x.helm.ui.note" })] });
    await h.backend.events(["x.helm.ui.note"], 9999);
    expect(h.calls.at(-1)?.params).toEqual({ threadId: OPEN, limit: 500 });
  });

  test("with no open thread nothing is read and nothing is returned", async () => {
    const h = harness(table, { openThreadId: () => undefined });
    expect(await h.backend.events(["x.helm.ui.note"], 10)).toEqual({ ok: true, value: [] });
    expect(h.calls).toEqual([]);
  });
});

describe("navigate, external links and the shell", () => {
  test("a shell target goes to the navigation function", async () => {
    const h = harness({});
    const target = { kind: "view", id: "detail" } as const;
    expect(await h.backend.navigate(target, false)).toEqual({ ok: true, value: null });
    expect(h.navigated).toEqual([target]);
  });

  test("a target the shell cannot open is answered as unsupported", async () => {
    const h = harness({});
    expect(await h.backend.navigate({ kind: "extension" }, false)).toEqual({
      ok: false,
      error: { kind: "failed", detail: "navigate_unsupported" },
    });
  });

  test("an external link opens its normalized href, never the raw text", async () => {
    const h = harness({});
    const link = {
      href: "https://example.com/",
      display: "https://example.com/",
      punycodeHost: undefined,
    };
    const result = await h.backend.navigate(
      { kind: "external", url: "https://example.com", link },
      true,
    );
    expect(result).toEqual({ ok: true, value: null });
    expect(h.opened).toEqual(["https://example.com/"]);
  });

  test("an external link without the shell confirmation is refused", async () => {
    const h = harness({});
    const link = {
      href: "https://example.com/",
      display: "https://example.com/",
      punycodeHost: undefined,
    };
    expect(
      await h.backend.navigate({ kind: "external", url: "https://example.com", link }, false),
    ).toEqual({ ok: false, error: { kind: "denied", detail: "not_confirmed" } });
    expect(h.opened).toEqual([]);
  });

  test("an opener that fails gives a fixed detail, not the error text", async () => {
    const h = harness(
      {},
      { openExternal: () => Promise.reject(new Error("no browser at /Applications/x")) },
    );
    const link = {
      href: "https://example.com/",
      display: "https://example.com/",
      punycodeHost: undefined,
    };
    const result = await h.backend.navigate(
      { kind: "external", url: "https://example.com", link },
      true,
    );
    expect(result).toEqual(refused("open_external"));
    expect(JSON.stringify(result)).not.toContain("Applications");
  });

  test("host reports the snapshot with the open thread id", () => {
    const h = harness({});
    expect(h.backend.host()).toEqual({ ...snapshot, threadId: OPEN });
  });

  test("resize and diagnostic go to their functions unchanged", () => {
    const h = harness({});
    h.backend.resize(320);
    h.backend.diagnostic({ op: "log", size: 12 });
    expect(h.resized).toEqual([320]);
    expect(h.diagnostics).toEqual([{ op: "log", size: 12 }]);
  });
});

describe("wire errors become bridge error names", () => {
  test("not found kinds become not_declared", async () => {
    const kinds = ["thread.notFound", "extension.notFound", "jsonrpc.methodNotFound"];
    const results = await Promise.all(
      kinds.map((kind) =>
        harness({ "command.run": rejecting(kind, "x") }).backend.command("helm", ""),
      ),
    );
    expect(results).toEqual(kinds.map(() => ({ ok: false, error: { kind: "not_declared" } })));
  });

  test("the safe mode and extension off kinds keep their names", async () => {
    const safe = harness({ "command.run": rejecting("extension.safeModeActive", "x") });
    expect(await safe.backend.command("helm", "")).toEqual({
      ok: false,
      error: { kind: "safe_mode" },
    });
    const off = harness({ "command.run": rejecting("ext.helm.off", "x") });
    expect(await off.backend.command("helm", "")).toEqual({
      ok: false,
      error: { kind: "extension_off" },
    });
  });

  test("invalid params become args_invalid with a fixed detail", async () => {
    const h = harness({
      "command.run": rejecting("jsonrpc.invalidParams", "params.text: too long"),
    });
    expect(await h.backend.command("helm", "")).toEqual({
      ok: false,
      error: { kind: "args_invalid", detail: "params" },
    });
  });

  test("any other kind is failed with a fixed detail and the wire message is dropped", async () => {
    const coded = harness({
      "command.run": rejecting("store.io", "disk /private/owner/secret-leak failed"),
    });
    const result = await coded.backend.command("helm", "");
    expect(result).toEqual(refused("wire_failed"));
    expect(JSON.stringify(result)).not.toContain("secret-leak");

    const thrown = harness({
      "command.run": () => Promise.reject(new Error("boom secret-leak")),
    });
    const other = await thrown.backend.command("helm", "");
    expect(other).toEqual(refused("wire_failed"));
    expect(JSON.stringify(other)).not.toContain("secret-leak");
  });
});

describe("connection", () => {
  test("each request reads the current connection, so a reconnect does not leave the screen on the old one", async () => {
    const before = fakeConnection({}, { "ext.helm.status": () => Promise.resolve("before") });
    const after = fakeConnection({}, { "ext.helm.status": () => Promise.resolve("after") });
    let current: HostConnection | undefined = before.connection;
    const h = harness({}, { connection: () => current });
    expect(await h.backend.query("status", {})).toEqual({ ok: true, value: "before" });
    current = after.connection;
    expect(await h.backend.query("status", {})).toEqual({ ok: true, value: "after" });
    expect(before.calls.length).toBe(1);
    expect(after.calls.length).toBe(1);
    current = undefined;
    expect(await h.backend.query("status", {})).toEqual({
      ok: false,
      error: { kind: "failed", detail: "offline" },
    });
  });
});
