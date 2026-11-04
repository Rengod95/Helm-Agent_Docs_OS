import { describe, expect, test } from "bun:test";
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
