import { describe, expect, test } from "bun:test";
import {
  LAYER_CODE,
  hasContrib,
  kindOf,
  matchesKind,
  sameSel,
  type Contrib,
  type KindFilter,
} from "../../../src/workbench/canvas/types.ts";
import { MOCK, plugin } from "./support.ts";

describe("sameSel", () => {
  test("same kind compares the id or the slot, and different kinds never match", () => {
    expect(sameSel({ k: "plugin", id: "helm" }, { k: "plugin", id: "helm" })).toEqual(true);
    expect(sameSel({ k: "plugin", id: "helm" }, { k: "plugin", id: "web" })).toEqual(false);
    expect(sameSel({ k: "plugin", id: "helm" }, { k: "group", id: "helm" })).toEqual(false);
    expect(sameSel({ k: "layer", id: "L1" }, { k: "layer", id: "L2" })).toEqual(false);
    expect(sameSel({ k: "hook", id: "thread.start" }, { k: "hook", id: "thread.start" })).toEqual(
      true,
    );
    expect(sameSel({ k: "builtin", slot: "hook:a" }, { k: "builtin", slot: "cap:a" })).toEqual(
      false,
    );
    expect(sameSel({ k: "agent" }, { k: "agent" })).toEqual(true);
    expect(sameSel({ k: "agent" }, { k: "layer", id: "L1" })).toEqual(false);
  });
});

describe("LAYER_CODE", () => {
  test("uses the manifest layer values, external is plugin", () => {
    expect(LAYER_CODE).toEqual({ L1: "L1", L2: "L2", L3: "L3", plugin: "plugin" });
  });
});

describe("kind filter", () => {
  test("kindOf puts a grouped plugin in group, an external layer in external, the rest in single", () => {
    expect(kindOf(plugin(MOCK, "helm"))).toEqual("group");
    expect(kindOf(plugin(MOCK, "web"))).toEqual("single");
    expect(kindOf(plugin(MOCK, "exa"))).toEqual("external");
  });

  test("the four filters partition the plugins: 7 grouped, 5 single, 6 external", () => {
    const kinds: readonly KindFilter[] = ["all", "group", "single", "external"];
    expect(kinds.map((k) => MOCK.plugins.filter((p) => matchesKind(p, k)).length)).toEqual([
      18, 7, 5, 6,
    ]);
  });

  test("an ungrouped external plugin is not a single plugin", () => {
    const kinds: readonly KindFilter[] = ["all", "group", "single", "external"];
    expect(kinds.map((k) => matchesKind(plugin(MOCK, "exa"), k))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  test("hasContrib counts hooks apart from the pieces", () => {
    const contribs: readonly Contrib[] = [
      "hook",
      "skill",
      "command",
      "tool",
      "mcp",
      "agent",
      "view",
    ];
    expect(contribs.filter((c) => hasContrib(plugin(MOCK, "helm"), c))).toEqual([
      "hook",
      "command",
    ]);
    expect(contribs.filter((c) => hasContrib(plugin(MOCK, "web"), c))).toEqual(["tool"]);
    expect(contribs.filter((c) => hasContrib(plugin(MOCK, "pr-kit"), c))).toEqual([
      "hook",
      "skill",
      "command",
      "mcp",
    ]);
  });
});
