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
import { appEntryOf, extGetOf, uiEntryOf } from "./support.ts";

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

function table(settings: readonly ReturnType<typeof setting>[]): Table {
  return {
    "ext.ui.list": () => Promise.resolve({ items: [page, app] }),
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
    expect(h.calls.map((call) => call.method)).toEqual(["ext.ui.list", "settings.get"]);
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
