import { describe, expect, test } from "bun:test";
import { currentEndTabOf } from "../../../src/views/shell/end-panel.tsx";
import { createShellRegistry, type EndTabDef } from "../../../src/views/shell/registry.ts";

function tab(id: string, screens?: readonly string[]): EndTabDef {
  return {
    id,
    area: "chat",
    label: "desktop.shell.nav.inbox",
    icon: null,
    render: () => null,
    ...(screens === undefined ? {} : { screens }),
  };
}

describe("registry.endTabs by screen", () => {
  const registry = createShellRegistry();
  registry.registerEndTab(tab("all"));
  registry.registerEndTab(tab("chat-only", ["chat"]));
  registry.registerEndTab(tab("two", ["chat", "inbox"]));

  test("without a screen every tab of the area is listed", () => {
    expect(registry.endTabs("chat").map((x) => x.id)).toEqual(["all", "chat-only", "two"]);
  });

  test("a tab with screens shows only on those screens", () => {
    expect(registry.endTabs("chat", "chat").map((x) => x.id)).toEqual(["all", "chat-only", "two"]);
    expect(registry.endTabs("chat", "inbox").map((x) => x.id)).toEqual(["all", "two"]);
    expect(registry.endTabs("chat", "schedules").map((x) => x.id)).toEqual(["all"]);
  });

  test("the other area keeps its own tabs", () => {
    expect(registry.endTabs("workbench", "chat")).toEqual([]);
  });
});

describe("registry plugin end tabs (DP-194)", () => {
  const registry = createShellRegistry();
  registry.registerEndTab(tab("inbox"));
  registry.registerPluginEndTab({
    ...tab("helm"),
    source: "plugin",
    description: "desktop.plugin.tab.helmDescription",
  });
  registry.registerPluginEndTab({
    ...tab("runtime", ["chat"]),
    source: "host",
    description: "desktop.shell.end.runtimeDescription",
  });

  test("plugin panels are kept apart from the bar tabs, in registration order, filtered like them", () => {
    expect(registry.endTabs("chat").map((x) => x.id)).toEqual(["inbox"]);
    expect(registry.pluginEndTabs("chat").map((x) => [x.id, x.source])).toEqual([
      ["helm", "plugin"],
      ["runtime", "host"],
    ]);
    expect(registry.pluginEndTabs("chat", "inbox").map((x) => x.id)).toEqual(["helm"]);
  });

  test("an id is one name space across the bar and the plugin menu", () => {
    expect(() => {
      registry.registerPluginEndTab({
        ...tab("inbox"),
        source: "plugin",
        description: "desktop.plugin.tab.helmDescription",
      });
    }).toThrow();
    expect(() => {
      registry.registerEndTab(tab("helm"));
    }).toThrow();
  });

  test("the current tab may be a plugin panel; an unknown id falls back to the first bar tab", () => {
    const bar = registry.endTabs("chat", "chat");
    const plugins = registry.pluginEndTabs("chat", "chat");
    expect(currentEndTabOf(bar, plugins, "runtime")?.id).toBe("runtime");
    expect(currentEndTabOf(bar, plugins, "gone")?.id).toBe("inbox");
  });
});
