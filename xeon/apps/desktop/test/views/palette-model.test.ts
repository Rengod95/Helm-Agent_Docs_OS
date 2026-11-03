import { describe, expect, test } from "bun:test";
import {
  availableCommands,
  commandValue,
  decodeValue,
  groupCellsOf,
  matchesQuery,
  moreValue,
  PALETTE_COMMAND_IDS,
  PALETTE_GROUP_LIMIT,
  settingValue,
  slashValue,
  threadValue,
  visibleGroupsOf,
  type GroupInput,
  type PaletteItem,
} from "../../src/views/palette/palette-model.ts";
import { approvalOriginView } from "../../src/views/approval-form.ts";

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
});

describe("palette groups", () => {
  test("a connected palette with an open thread shows the four groups in spec order", () => {
    expect(visibleGroupsOf({ live: true, hasThread: true })).toEqual([
      "thread",
      "command",
      "slash",
      "setting",
    ]);
  });

  test("offline the palette keeps only the app actions", () => {
    expect(visibleGroupsOf({ live: false, hasThread: true })).toEqual(["command"]);
    expect(visibleGroupsOf({ live: false, hasThread: false })).toEqual(["command"]);
  });

  test("without an open thread the slash group is not shown", () => {
    expect(visibleGroupsOf({ live: true, hasThread: false })).toEqual([
      "thread",
      "command",
      "setting",
    ]);
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
  });
});
