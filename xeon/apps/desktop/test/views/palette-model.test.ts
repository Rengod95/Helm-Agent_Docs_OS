import { describe, expect, test } from "bun:test";
import {
  availableCommands,
  commandValue,
  countedUse,
  decodeValue,
  enterRunsFirstRow,
  groupCellsOf,
  matchesQuery,
  moreValue,
  PALETTE_COMMAND_IDS,
  PALETTE_GROUP_LIMIT,
  pluginCommandItemsOf,
  pluginValue,
  PALETTE_USE_MAX,
  screenTargetsOf,
  screenValue,
  settingValue,
  slashValue,
  threadValue,
  visibleGroupsOf,
  type GroupInput,
  type PaletteItem,
} from "../../src/views/palette/palette-model.ts";
import { approvalOriginView } from "../../src/views/approval-form.ts";
import { uiEntryOf } from "../plugin-ui/support.ts";

describe("palette values", () => {
  test("a thread value and a command value read back as what they were made from", () => {
    expect(decodeValue(threadValue("thr_abc"))).toEqual({ kind: "thread", threadId: "thr_abc" });
    expect(decodeValue(commandValue("thread.new"))).toEqual({ kind: "command", id: "thread.new" });
    for (const id of PALETTE_COMMAND_IDS) {
      expect(decodeValue(commandValue(id))).toEqual({ kind: "command", id });
    }
  });

  test("unknown commands, empty ids and other shapes are not values", () => {
    expect(decodeValue("command:rm.rf")).toBeNull();
    expect(decodeValue("thread:")).toBeNull();
    expect(decodeValue("settings:x")).toBeNull();
    expect(decodeValue("nocolon")).toBeNull();
    expect(decodeValue("status:slash")).toBeNull();
  });

  test("a slash command value reads back as its name, and an empty name is not a value", () => {
    expect(decodeValue(slashValue("helm"))).toEqual({ kind: "slash", name: "helm" });
    expect(decodeValue("slash:")).toBeNull();
  });

  test("a setting value reads back as its tab and key; an empty key means the tab alone", () => {
    expect(decodeValue(settingValue("models", "l1.models.accounts"))).toEqual({
      kind: "setting",
      tab: "models",
      key: "l1.models.accounts",
    });
    expect(decodeValue(settingValue("sandbox", null))).toEqual({
      kind: "setting",
      tab: "sandbox",
      key: null,
    });
  });

  test("a setting value with an unknown tab or no tab separator is not a value", () => {
    expect(decodeValue("setting:nosuchtab:l1.x")).toBeNull();
    expect(decodeValue("setting:models")).toBeNull();
  });

  test("a more value reads back as its group and an unknown group is not a value", () => {
    expect(decodeValue(moreValue("slash"))).toEqual({ kind: "more", group: "slash" });
    expect(decodeValue("more:unknown")).toBeNull();
  });

  test("without an open thread the interrupt command is not offered", () => {
    expect(availableCommands(false).map((c) => c.id)).not.toContain("turn.interrupt");
    expect(availableCommands(true).map((c) => c.id)).toContain("turn.interrupt");
    expect(availableCommands(true)).toHaveLength(PALETTE_COMMAND_IDS.length);
  });

  test("the start command opens the first-run screen, is offered without a thread, and reads back as itself", () => {
    expect(availableCommands(false).map((c) => c.id)).toContain("firstRun.open");
    expect(decodeValue(commandValue("firstRun.open"))).toEqual({
      kind: "command",
      id: "firstRun.open",
    });
  });

  test("the command ids are exactly the first eight and the seven actions added from spec §4.5", () => {
    expect([...PALETTE_COMMAND_IDS]).toEqual([
      "thread.new",
      "turn.interrupt",
      "inbox.open",
      "settings.open",
      "firstRun.open",
      "area.toggle",
      "engine.restart",
      "diagnostics.copy",
      "thread.fork",
      "thread.compact",
      "turn.resume",
      "explore.start",
      "explore.stop",
      "goal.clear",
      "connection.open",
    ]);
    for (const id of PALETTE_COMMAND_IDS) {
      expect(decodeValue(commandValue(id))).toEqual({ kind: "command", id });
    }
  });

  test("without an open thread the actions on a thread are left out and the connection action stays", () => {
    expect(availableCommands(false).map((c) => c.id)).toEqual([
      "thread.new",
      "inbox.open",
      "settings.open",
      "firstRun.open",
      "area.toggle",
      "engine.restart",
      "diagnostics.copy",
      "connection.open",
    ]);
  });
});

describe("palette command order", () => {
  test("with no counts the commands keep the table order", () => {
    expect(availableCommands(true, {}).map((c) => c.id)).toEqual([...PALETTE_COMMAND_IDS]);
  });

  test("the most used commands come first, and a tie keeps the table order", () => {
    const uses = { "engine.restart": 3, "thread.new": 1, "diagnostics.copy": 3 };
    expect(availableCommands(true, uses).map((c) => c.id)).toEqual([
      "engine.restart",
      "diagnostics.copy",
      "thread.new",
      "turn.interrupt",
      "inbox.open",
      "settings.open",
      "firstRun.open",
      "area.toggle",
      "thread.fork",
      "thread.compact",
      "turn.resume",
      "explore.start",
      "explore.stop",
      "goal.clear",
      "connection.open",
    ]);
  });

  test("the first five of the ranked list are the five most used actions", () => {
    const uses = {
      "goal.clear": 5,
      "connection.open": 4,
      "explore.start": 3,
      "turn.resume": 2,
      "thread.fork": 1,
    };
    expect(
      availableCommands(true, uses)
        .slice(0, 5)
        .map((c) => c.id),
    ).toEqual(["goal.clear", "connection.open", "explore.start", "turn.resume", "thread.fork"]);
  });

  test("counts for ids that are not in the table are dropped", () => {
    const ranked = availableCommands(true, { "rm.rf": 99, "thread.new": 1 }).map((c) => c.id);
    expect(ranked).not.toContain("rm.rf");
    expect(ranked).toHaveLength(PALETTE_COMMAND_IDS.length);
    expect(ranked[0]).toBe("thread.new");
  });

  test("a counted command still needs an open thread to be offered", () => {
    const ranked = availableCommands(false, { "thread.fork": 9, "thread.new": 1 }).map((c) => c.id);
    expect(ranked).not.toContain("thread.fork");
    expect(ranked[0]).toBe("thread.new");
  });

  test("a counted use adds one, starts from zero, stops at the maximum, and leaves the input alone", () => {
    expect(countedUse({}, "thread.new")).toEqual({ "thread.new": 1 });
    const before = { "thread.new": 4 };
    expect(countedUse(before, "thread.new")).toEqual({ "thread.new": 5 });
    expect(before).toEqual({ "thread.new": 4 });
    expect(countedUse({ "thread.new": PALETTE_USE_MAX }, "thread.new")).toEqual({
      "thread.new": PALETTE_USE_MAX,
    });
  });
});

describe("palette groups", () => {
  test("a connected palette with an open thread shows the six groups in spec order, screens last", () => {
    expect(visibleGroupsOf({ live: true, hasThread: true })).toEqual([
      "thread",
      "command",
      "plugin",
      "slash",
      "setting",
      "screen",
    ]);
  });

  test("the plugin group needs a connection and an open thread, like the slash group", () => {
    expect(visibleGroupsOf({ live: true, hasThread: false })).not.toContain("plugin");
    expect(visibleGroupsOf({ live: false, hasThread: true })).not.toContain("plugin");
  });

  test("offline the palette keeps the app actions and the screen navigation only", () => {
    expect(visibleGroupsOf({ live: false, hasThread: true })).toEqual(["command", "screen"]);
    expect(visibleGroupsOf({ live: false, hasThread: false })).toEqual(["command", "screen"]);
  });

  test("without an open thread the slash group is not shown", () => {
    expect(visibleGroupsOf({ live: true, hasThread: false })).toEqual([
      "thread",
      "command",
      "setting",
      "screen",
    ]);
  });
});

describe("plugin command values and rows", () => {
  test("a plugin value reads back as its extension and item id", () => {
    expect(decodeValue(pluginValue("helm", "helm-start"))).toEqual({
      kind: "plugin",
      extension: "helm",
      id: "helm-start",
    });
  });

  test("a plugin value without an extension, an id, or the separator is not a value", () => {
    expect(decodeValue("plugin:helm")).toBeNull();
    expect(decodeValue("plugin:/helm-start")).toBeNull();
    expect(decodeValue("plugin:helm/")).toBeNull();
  });

  test("a row's label starts with the extension name, then the title, and the description is the extension", () => {
    const rows = pluginCommandItemsOf([
      uiEntryOf({ id: "helm-start", placement: "command", title: "탐구 시작…" }),
    ]);
    expect(rows).toEqual([
      {
        value: "plugin:helm/helm-start",
        label: "helm · 탐구 시작…",
        description: "helm",
        meta: null,
      },
    ]);
  });

  test("the title in a label loses its bidi and control characters, and an empty title shows the id", () => {
    const rows = pluginCommandItemsOf([
      uiEntryOf({ extension: "aaa", id: "go", placement: "command", title: "‮탐구\u0007 시작" }),
      uiEntryOf({ extension: "aaa", id: "blank", placement: "command", title: "​" }),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["aaa · 탐구 시작", "aaa · blank"]);
  });
});

describe("palette screen navigation", () => {
  test("the current area's nav screens come first, then the other area's", () => {
    expect(screenTargetsOf("chat").map((t) => screenValue(t.area, t.screen))).toEqual([
      "screen:chat:chat",
      "screen:chat:inbox",
      "screen:chat:proposals",
      "screen:chat:schedules",
      "screen:chat:connection",
      "screen:chat:plugins",
      "screen:workbench:overview",
      "screen:workbench:extensions",
      "screen:workbench:tests",
      "screen:workbench:metrics",
      "screen:workbench:compose",
      "screen:workbench:engine",
    ]);
    expect(screenTargetsOf("workbench").map((t) => t.screen)).toEqual([
      "overview",
      "extensions",
      "tests",
      "metrics",
      "compose",
      "engine",
      "chat",
      "inbox",
      "proposals",
      "schedules",
      "connection",
      "plugins",
    ]);
  });

  test("the plugin pages row is the chat area's sixth screen and carries the nav.6 shortcut", () => {
    expect(screenTargetsOf("chat").find((t) => t.screen === "plugins")).toEqual({
      area: "chat",
      screen: "plugins",
      label: "desktop.shell.nav.plugins",
      areaLabel: "desktop.shell.area.chat",
      action: "nav.6",
    });
  });

  test("a screen row carries the nav label keys and the shortcut of its nav item when it has one", () => {
    const inbox = screenTargetsOf("chat").find((t) => t.screen === "inbox");
    expect(inbox).toEqual({
      area: "chat",
      screen: "inbox",
      label: "desktop.shell.nav.inbox",
      areaLabel: "desktop.shell.area.chat",
      action: "nav.2",
    });
    expect(screenTargetsOf("chat").find((t) => t.screen === "overview")?.action).toBeUndefined();
  });

  test("a screen value reads back as its area and screen, and an unknown area or a screen of the other area is not a value", () => {
    expect(decodeValue(screenValue("chat", "inbox"))).toEqual({
      kind: "screen",
      area: "chat",
      screen: "inbox",
    });
    expect(decodeValue(screenValue("workbench", "metrics"))).toEqual({
      kind: "screen",
      area: "workbench",
      screen: "metrics",
    });
    expect(decodeValue("screen:chat:overview")).toBeNull();
    expect(decodeValue("screen:nowhere:chat")).toBeNull();
    expect(decodeValue("screen:chat")).toBeNull();
    expect(decodeValue("screen:")).toBeNull();
  });
});

const item = (label: string, description: string | null = null): PaletteItem => ({
  value: `thread:${label}`,
  label,
  description,
  meta: null,
});

describe("palette matching", () => {
  test("the query ignores case and surrounding spaces and reads the label and the description", () => {
    const row = item("Cache Study", "fresnel");
    expect(matchesQuery(row, "  cache ")).toBe(true);
    expect(matchesQuery(row, "FRESNEL")).toBe(true);
    expect(matchesQuery(row, "lamp")).toBe(false);
  });

  test("an empty query matches everything", () => {
    expect(matchesQuery(item("alpha"), "")).toBe(true);
    expect(matchesQuery(item("alpha"), "   ")).toBe(true);
  });
});

describe("palette group cells", () => {
  const alpha = item("alpha");
  const bravo = item("bravo");
  const charlie = item("charlie");
  const delta = item("delta");
  const echo = item("echo");
  const foxtrot = item("foxtrot");
  const golf = item("golf");
  const seven = [alpha, bravo, charlie, delta, echo, foxtrot, golf];
  const input = (over: Partial<GroupInput>): GroupInput => ({
    group: "thread",
    items: seven,
    status: "ready",
    query: "",
    expanded: false,
    ...over,
  });

  test("the first five matching rows show and a more row counts the rest", () => {
    expect(PALETTE_GROUP_LIMIT).toBe(5);
    const cells = groupCellsOf(input({}));
    expect(
      cells.slice(0, 5).map((cell) => (cell.kind === "item" ? cell.item.label : cell.kind)),
    ).toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
    expect(cells[5]).toEqual({ kind: "more", value: "more:thread", hidden: 2 });
    expect(cells).toHaveLength(6);
  });

  test("an expanded group shows every row and no more row", () => {
    const cells = groupCellsOf(input({ expanded: true }));
    expect(cells).toHaveLength(7);
    expect(cells.some((cell) => cell.kind === "more")).toBe(false);
  });

  test("a group of five or fewer has no more row", () => {
    const cells = groupCellsOf(input({ items: seven.slice(0, 5) }));
    expect(cells).toHaveLength(5);
    expect(cells.some((cell) => cell.kind === "more")).toBe(false);
  });

  test("the query narrows the rows before the cap is applied", () => {
    // 일곱 가운데 "o"가 든 것은 bravo, echo, foxtrot, golf 넷이라 다섯을 넘지 않아 더 보기가 없다
    const cells = groupCellsOf(input({ query: "o" }));
    expect(cells).toEqual([
      { kind: "item", item: bravo },
      { kind: "item", item: echo },
      { kind: "item", item: foxtrot },
      { kind: "item", item: golf },
    ]);
  });

  test("a loading or failed group ends with a status row after its rows", () => {
    expect(groupCellsOf(input({ items: [], status: "loading" }))).toEqual([
      { kind: "status", value: "status:thread", status: "loading" },
    ]);
    const failed = groupCellsOf(input({ items: [alpha, bravo], status: "failed" }));
    expect(failed).toEqual([
      { kind: "item", item: alpha },
      { kind: "item", item: bravo },
      { kind: "status", value: "status:thread", status: "failed" },
    ]);
  });

  test("a ready group with no matching row is empty", () => {
    expect(groupCellsOf(input({ items: [], status: "ready" }))).toEqual([]);
    expect(groupCellsOf(input({ query: "zulu" }))).toEqual([]);
  });
});

describe("approvalOriginView", () => {
  test("main shows nothing; background, host, sub-agents and extension groups show their source", () => {
    expect(approvalOriginView("main")).toBeNull();
    expect(approvalOriginView("background")).toEqual({ kind: "background" });
    expect(approvalOriginView("host")).toEqual({ kind: "host" });
    expect(approvalOriginView("subagent:렌즈")).toEqual({ kind: "subagent", name: "렌즈" });
    expect(approvalOriginView("ext:helm")).toEqual({ kind: "group", name: "helm" });
    expect(
      approvalOriginView("subagent:explorer", { scopeId: "helm", label: "렌즈 실패 사례" }),
    ).toEqual({
      kind: "groupChild",
      name: "explorer",
      label: "렌즈 실패 사례",
      scope: "helm",
    });
    expect(approvalOriginView("subagent:explorer", { scopeId: "helm", label: null })).toEqual({
      kind: "groupChild",
      name: "explorer",
      label: null,
      scope: "helm",
    });
    expect(approvalOriginView("main", { scopeId: "helm", label: "x" })).toBeNull();
  });
});

describe("enterRunsFirstRow (scD 3-1)", () => {
  const typed = { key: "Enter", composing: false, query: "설정", hasActiveRow: false };

  test("Enter after typing with no chosen row runs the first row", () => {
    expect(enterRunsFirstRow(typed)).toBe(true);
  });

  test("a chosen row, an empty query, composition or another key leave Enter alone", () => {
    expect(enterRunsFirstRow({ ...typed, hasActiveRow: true })).toBe(false);
    expect(enterRunsFirstRow({ ...typed, query: "" })).toBe(false);
    expect(enterRunsFirstRow({ ...typed, composing: true })).toBe(false);
    expect(enterRunsFirstRow({ ...typed, key: "ArrowDown" })).toBe(false);
  });
});
