import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { AppRootsInvoke } from "../../src/plugin-ui/app-roots.ts";
import {
  createPluginUiRuntime,
  newFrameNonce,
  type PluginUiRuntimeDeps,
} from "../../src/plugin-ui/runtime.ts";
import { fakeConnection, type Table } from "../state/fake-connection.ts";
import { appEntryOf, extGetOf, extListEntryOf, uiEntryOf } from "./support.ts";

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

function harness(table: Table, options: { framesSupported?: boolean; offline?: boolean } = {}) {
  const fake = fakeConnection(table);
  const roots: unknown[] = [];
  const invoke: AppRootsInvoke = (_command, args) => {
    roots.push(args);
    return Promise.resolve(null);
  };
  const deps: PluginUiRuntimeDeps = {
    withConnection: async <T>(run: (connection: HostConnection) => Promise<T>) => {
      if (options.offline === true) return err({ kind: "offline" });
      return ok(await run(fake.connection));
    },
    appRootsInvoke: invoke,
    framesSupported: options.framesSupported ?? true,
  };
  return { runtime: createPluginUiRuntime(deps), roots, calls: fake.calls };
}

const commandInfo = (name: string, origin: string) => ({
  name,
  description: "",
  argumentHint: null,
  args: [],
  kind: "action" as const,
  source: "extension" as const,
  origin,
  hasShell: false,
});

const page = uiEntryOf({ id: "status" });
const app = appEntryOf({ id: "graph", placement: "page" });

function table(
  settings: readonly ReturnType<typeof setting>[],
  extensions: ReturnType<typeof extListEntryOf>[] = [extListEntryOf("helm")],
): Table {
  return {
    "ext.ui.list": () => Promise.resolve({ items: [page, app] }),
    "ext.list": () => Promise.resolve({ extensions }),
    "settings.get": () => Promise.resolve({ settings: [...settings] }),
  };
}

describe("plugin ui runtime", () => {
  test("refresh reads the list and settings, groups placements, and sends the app roots", async () => {
    const h = harness(table([setting("x.ui.apps", true)]));
    expect(h.runtime.getState().phase).toBe("loading");
    await h.runtime.refresh();
    const state = h.runtime.getState();
    expect(state.phase).toBe("ready");
    expect(state.groups.page.map((placed) => [placed.entry.id, placed.blocked])).toEqual([
      ["graph", null],
      ["status", null],
    ]);
    expect(h.roots).toEqual([{ entries: [expect.objectContaining({ extension: "helm" })] }]);
    expect(h.calls.map((call) => call.method)).toEqual(["ext.ui.list", "ext.list", "settings.get"]);
    expect(h.runtime.framesAllowed(app)).toBe(true);
  });

  test("x.ui.apps false blocks apps and an unsupported device blocks them whatever the setting", async () => {
    const off = harness(table([setting("x.ui.apps", false)]));
    await off.runtime.refresh();
    expect(off.runtime.getState().groups.page.find((p) => p.entry.id === "graph")?.blocked).toBe(
      "frame_blocked",
    );
    expect(off.runtime.framesAllowed(app)).toBe(false);

    const windows = harness(table([setting("x.ui.apps", true)]), { framesSupported: false });
    await windows.runtime.refresh();
    expect(windows.runtime.framesAllowed(app)).toBe(false);
    expect(windows.roots).toEqual([]);
  });

  test("an app of an extension left out of every profile still opens, and one left out by safe mode loses its app root and frame", async () => {
    let extensions = [extListEntryOf("helm", { status: "disabled" })];
    const h = harness({
      ...table([setting("x.ui.apps", true)]),
      "ext.list": () => Promise.resolve({ extensions }),
    });
    await h.runtime.refresh();
    expect([...h.runtime.getState().inactive]).toEqual(["helm"]);
    expect(h.runtime.framesAllowed(app)).toBe(true);
    expect(h.roots.at(-1)).toEqual({ entries: [expect.objectContaining({ extension: "helm" })] });

    extensions = [extListEntryOf("helm", { safeModeExcluded: "safe mode" })];
    await h.runtime.refresh();
    expect([...h.runtime.getState().inactive]).toEqual(["helm"]);
    expect(h.runtime.framesAllowed(app)).toBe(false);
    expect(h.roots.at(-1)).toEqual({ entries: [] });

    extensions = [extListEntryOf("helm")];
    await h.runtime.refresh();
    expect([...h.runtime.getState().inactive]).toEqual([]);
    expect(h.runtime.framesAllowed(app)).toBe(true);
    expect(h.roots.at(-1)).toEqual({ entries: [expect.objectContaining({ extension: "helm" })] });
  });

  test("a plugin deferred at startup is not inactive, a plugin turned off is", async () => {
    const h = harness({
      ...table([setting("x.ui.apps", true)]),
      "ext.list": () =>
        Promise.resolve({
          extensions: [
            extListEntryOf("helm", { status: "disabled", deferred: true }),
            extListEntryOf("kanban", { status: "disabled" }),
          ],
        }),
    });
    await h.runtime.refresh();
    expect([...h.runtime.getState().inactive]).toEqual(["kanban"]);
  });

  test("refreshes that overlap are merged: one more read runs after the first, not one per request", async () => {
    const h = harness(table([setting("x.ui.apps", true)]));
    await Promise.all([h.runtime.refresh(), h.runtime.refresh(), h.runtime.refresh()]);
    expect(h.calls.filter((call) => call.method === "ext.ui.list").length).toBe(2);
  });

  test("roots the shell skipped are kept in the state, and the rest of the list still reaches it", async () => {
    const fake = fakeConnection(table([setting("x.ui.apps", true)]));
    const runtime = createPluginUiRuntime({
      withConnection: async <T>(run: (connection: HostConnection) => Promise<T>) =>
        ok(await run(fake.connection)),
      appRootsInvoke: () => Promise.resolve([{ index: 0, kind: "outside_install" }]),
      framesSupported: true,
    });
    await runtime.refresh();
    expect(runtime.getState().rootsSkipped).toEqual([
      { extension: "helm", version: "0.1.0", kind: "outside_install" },
    ]);
  });

  test("an offline engine keeps the last entries and says offline", async () => {
    const h = harness(table([]), { offline: true });
    await h.runtime.refresh();
    expect(h.runtime.getState().phase).toBe("offline");
    expect(h.runtime.getState().entries).toEqual([]);
  });

  test("contextFor builds the bridge context from ext.get and command.list", async () => {
    const commandTable: Table = {
      "ext.get": () => Promise.resolve(extGetOf()),
      "command.list": () =>
        Promise.resolve({
          commands: [commandInfo("helm", "helm"), commandInfo("other", "other-ext")],
        }),
    };
    const h = harness(commandTable);
    const context = await h.runtime.contextFor(page, undefined);
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect([...context.value.ownCommands]).toEqual(["helm"]);
    expect(context.value.trust).toBe("user");
  });

  test("subscribers hear every state change and can unsubscribe", async () => {
    const h = harness(table([]));
    let heard = 0;
    const stop = h.runtime.subscribe(() => {
      heard += 1;
    });
    await h.runtime.refresh();
    stop();
    await h.runtime.refresh();
    expect(heard).toBe(1);
  });

  test("newFrameNonce is 32 hex characters from the given random source", () => {
    const nonce = newFrameNonce((bytes) => {
      bytes.fill(0xab);
    });
    expect(nonce).toBe("ab".repeat(16));
  });
});

describe("plugin ui runtime: user layout (AGE-73)", () => {
  test("refresh reads x.ui.hidden and x.ui.order, and a hidden page leaves its placement", async () => {
    const h = harness(table([setting("x.ui.hidden", ["helm/status"])]));
    await h.runtime.refresh();
    const settingsCall = h.calls.find((call) => call.method === "settings.get");
    expect(settingsCall?.params).toEqual({
      keys: ["x.ui.apps", "x.ui.allowProjectApps", "x.ui.hidden", "x.ui.order"],
    });
    const state = h.runtime.getState();
    expect([...state.layout.hidden]).toEqual(["helm/status"]);
    expect(state.groups.page.map(({ entry }) => entry.id)).toEqual(["graph"]);
    expect(state.entries.map((entry) => entry.id)).toEqual(["status", "graph"]);
  });

  test("saveLayout shows the change at once and writes both keys in the user scope", async () => {
    const writes: unknown[] = [];
    const h = harness({
      ...table([]),
      "settings.set": (params) => {
        writes.push(params);
        return Promise.resolve({ setting: setting("x.ui.hidden", []) });
      },
    });
    await h.runtime.refresh();
    const saved = await h.runtime.saveLayout({
      hidden: new Set(["helm/graph"]),
      order: { status: [], panel: ["helm/graph", "helm/status"] },
    });
    expect(saved.ok).toBe(true);
    expect(writes).toEqual([
      { key: "x.ui.hidden", value: ["helm/graph"], scope: "user" },
      { key: "x.ui.order", value: { panel: ["helm/graph", "helm/status"] }, scope: "user" },
    ]);
    expect(h.runtime.getState().groups.page.map(({ entry }) => entry.id)).toEqual(["status"]);
  });

  test("a failed write puts the old layout back and returns write_failed", async () => {
    const h = harness(table([]), { offline: true });
    const saved = await h.runtime.saveLayout({
      hidden: new Set(["helm/graph"]),
      order: { status: [], panel: [] },
    });
    expect(saved).toEqual({ ok: false, error: { kind: "write_failed" } });
    expect([...h.runtime.getState().layout.hidden]).toEqual([]);
  });
});

const testRecord = (state: "running" | "failed") => ({
  testId: "tst_1",
  kind: "testRun" as const,
  target: "",
  state,
  startedAt: "2026-11-24T00:00:00.000Z",
  durationMs: null,
  threadId: "thr_test",
  replay: null,
});

describe("a draft test conversation", () => {
  const draftApp = appEntryOf({ extension: "dabc123-helm", draft: true });
  const draftTable = (state: "running" | "failed"): Table => ({
    "ext.ui.list": (params) =>
      Promise.resolve({
        items: "threadId" in params ? [draftApp, app] : [app],
      }),
    "ext.list": () => Promise.resolve({ extensions: [extListEntryOf("helm")] }),
    "settings.get": () => Promise.resolve({ settings: [setting("x.ui.apps", true)] }),
    "ext.test.list": () => Promise.resolve({ tests: [testRecord(state)] }),
  });

  test("while the test runs the draft screen is listed and its app root is sent as the draft tier", async () => {
    const h = harness(draftTable("running"));
    await h.runtime.refresh("thr_test");
    expect(h.runtime.getState().entries.map((entry) => entry.extension)).toEqual([
      "dabc123-helm",
      "helm",
    ]);
    expect(h.roots).toEqual([
      {
        entries: [
          expect.objectContaining({ extension: "dabc123-helm", trust: "draft" }),
          expect.objectContaining({ extension: "helm", trust: "user" }),
        ],
      },
    ]);
  });

  test("once the open test conversation has ended, a refresh drops the draft entry and its app root", async () => {
    const h = harness(draftTable("failed"));
    await h.runtime.refresh("thr_test");
    expect(h.runtime.getState().entries.map((entry) => entry.extension)).toEqual(["helm"]);
    expect(h.roots).toEqual([{ entries: [expect.objectContaining({ extension: "helm" })] }]);
    expect(h.calls.find((call) => call.method === "ext.ui.list")?.params).toEqual({});
  });
});
