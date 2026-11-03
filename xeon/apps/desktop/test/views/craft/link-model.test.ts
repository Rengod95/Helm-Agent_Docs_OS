import { describe, expect, test } from "bun:test";
import {
  relationsOf,
  type CanvasGroup,
  type CanvasPlugin,
  type CanvasSnapshot,
} from "@fresnel/client/workbench/canvas";
import {
  driveContext,
  driveHolder,
  focusOf,
  kindsOf,
  relationContext,
  rowsOf,
  visibleFacts,
} from "../../../src/views/craft/link-model.ts";

function plug(id: string, extra: Partial<CanvasPlugin> = {}): CanvasPlugin {
  return {
    id,
    name: id,
    layer: "L1",
    origin: "builtin",
    hooks: [],
    provides: [],
    pieces: [],
    on: true,
    ...extra,
  };
}

function snap(plugins: CanvasPlugin[], groups: CanvasGroup[] = []): CanvasSnapshot {
  return { plugins, groups };
}

const G1: CanvasGroup = {
  id: "g1",
  name: "G",
  version: "1.0.0",
  origin: "builtin",
  members: ["a", "b"],
};

/**
 * a(그룹 g1, 주도, 훅 tool.call.before, 기능 cap.x 제공, 기록 k.one 남김)
 * b(그룹 g1, 주도, 훅 tool.call.before, 기능 cap.x 필요)
 * c(기록 k.* 읽음)
 */
const linked = snap(
  [
    plug("a", {
      group: "g1",
      drives: true,
      hooks: ["tool.call.before"],
      provides: ["cap.x"],
      records: ["k.one"],
    }),
    plug("b", { group: "g1", drives: true, hooks: ["tool.call.before"], requires: ["cap.x"] }),
    plug("c", { layer: "L2", reads: ["k.*"] }),
  ],
  [G1],
);

describe("driveHolder and driveContext", () => {
  test("the first plugin that drives and is on holds the drive", () => {
    const s = snap([plug("x", { drives: true }), plug("y", { drives: true })]);
    expect(driveHolder(s)).toBe("x");
    expect(driveContext(s)).toEqual({ holder: "x", turns: [0, 0] });
  });

  test("a plugin that is off is skipped", () => {
    const s = snap([plug("x", { drives: true, on: false }), plug("y", { drives: true })]);
    expect(driveContext(s)).toEqual({ holder: "y", turns: [0, 0] });
  });

  test("an auto-disabled plugin does not hold the drive", () => {
    const health = {
      fails: 5,
      hook: "tool.call.before",
      text: "t",
      at: "14:01",
      limit: 5,
      autoOff: true,
    };
    const s = snap([plug("x", { drives: true, health }), plug("y", { drives: true })]);
    expect(driveContext(s)).toEqual({ holder: "y", turns: [0, 0] });
  });

  test("no driving plugin means no holder", () => {
    const s = snap([plug("x"), plug("y", { drives: true, on: false })]);
    expect(driveHolder(s)).toBeNull();
    expect(driveContext(s)).toEqual({ holder: null, turns: [0, 0] });
  });

  test("relationContext carries the given order and the drive context", () => {
    const s = snap([plug("x", { drives: true })]);
    const order = { "tool.call.before": ["x"] };
    expect(relationContext(s, order)).toEqual({
      order: { "tool.call.before": ["x"] },
      drive: { holder: "x", turns: [0, 0] },
    });
  });
});

describe("focusOf", () => {
  test("a selected plugin is its own focus", () => {
    expect(focusOf({ k: "plugin", id: "b" }, linked)?.id).toBe("b");
  });

  test("a group focuses on its root plugin (id equal to the group id) when there is one", () => {
    const s = snap([plug("g1", { group: "g1" }), plug("a", { group: "g1" })], [G1]);
    expect(focusOf({ k: "group", id: "g1" }, s)?.id).toBe("g1");
  });

  test("a group without a root plugin focuses on its first member", () => {
    expect(focusOf({ k: "group", id: "g1" }, linked)?.id).toBe("a");
  });

  test("other selections (agent, layer, hook, builtin) focus on the drive holder", () => {
    expect(focusOf({ k: "agent" }, linked)?.id).toBe("a");
    expect(focusOf({ k: "hook", id: "tool.call.before" }, linked)?.id).toBe("a");
  });

  test("with no driving plugin, the first plugin is the focus", () => {
    expect(focusOf({ k: "agent" }, snap([plug("p"), plug("q")]))?.id).toBe("p");
  });

  test("an unknown plugin id falls back to the holder", () => {
    expect(focusOf({ k: "plugin", id: "missing" }, linked)?.id).toBe("a");
  });

  test("an empty snapshot has no focus", () => {
    expect(focusOf({ k: "agent" }, snap([]))).toBeUndefined();
  });
});

describe("rowsOf and kindsOf", () => {
  test("related plugins become rows: more relations first, each row keeps the kinds in REL_ORDER", () => {
    const rels = relationsOf(linked.plugins[0] ?? plug("none"), linked, {
      order: { "tool.call.before": ["a", "b"] },
      drive: { holder: "a", turns: [0, 0] },
    });
    const rows = rowsOf(rels);
    expect(rows.map((r) => [r.other.id, r.list.map((x) => x.kind)])).toEqual([
      ["b", ["hook", "cap", "group", "drive"]],
      ["c", ["record"]],
    ]);
    expect(kindsOf(rels)).toEqual(["hook", "cap", "group", "drive", "record"]);
  });

  test("rows with the same relation count are ordered by name", () => {
    const s = snap([
      plug("hub", { drives: true }),
      plug("zeta", { drives: true }),
      plug("alpha", { drives: true }),
    ]);
    const rels = relationsOf(s.plugins[0] ?? plug("none"), s, {
      order: {},
      drive: { holder: null, turns: [0, 0] },
    });
    expect(rowsOf(rels).map((r) => r.other.id)).toEqual(["alpha", "zeta"]);
  });
});

describe("visibleFacts", () => {
  test("the drive limit fact is hidden while the turn budget is unknown (max 0)", () => {
    const rels = relationsOf(
      plug("a", { drives: true }),
      snap([plug("a", { drives: true }), plug("b", { drives: true })]),
      {
        order: {},
        drive: { holder: "a", turns: [0, 0] },
      },
    );
    const drive = rels.find((r) => r.kind === "drive");
    expect(drive).toBeDefined();
    if (drive === undefined) throw new Error("expected a drive relation");
    expect(drive.facts.map((f) => f.labelKey)).toEqual(["rel.fact.drive", "rel.fact.limit"]);
    expect(visibleFacts(drive).map((f) => f.labelKey)).toEqual(["rel.fact.drive"]);
  });

  test("facts with a real meter (order position) stay visible", () => {
    const rels = relationsOf(linked.plugins[0] ?? plug("none"), linked, {
      order: { "tool.call.before": ["a", "b"] },
      drive: { holder: "a", turns: [0, 0] },
    });
    const hook = rels.find((r) => r.kind === "hook");
    if (hook === undefined) throw new Error("expected a hook relation");
    expect(visibleFacts(hook).map((f) => f.labelKey)).toEqual([
      "rel.fact.hook",
      "rel.fact.dir",
      "rel.fact.rule",
      "rel.fact.order",
      "rel.fact.failure",
    ]);
    expect(hook.facts.map((f) => f.labelKey)).toEqual(visibleFacts(hook).map((f) => f.labelKey));
  });
});
