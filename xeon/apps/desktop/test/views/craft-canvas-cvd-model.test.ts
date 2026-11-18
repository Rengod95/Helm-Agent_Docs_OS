import { describe, expect, test } from "bun:test";
import {
  CHIP_X0,
  COL_STEP,
  entriesAt,
  hasPlugin,
  layoutProfile,
  nearestSlot,
  placePlugin,
  removePlugin,
  shiftPlugin,
  type CanvasProfile,
  type LayoutOptions,
} from "../../src/views/craft/canvas/cvD/model.ts";
import { SAMPLE_PROFILES } from "../../src/views/craft/canvas/cvD/sample.ts";

function sample(id: string): CanvasProfile {
  const p = SAMPLE_PROFILES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`sample profile ${id} missing`);
  return { id: p.id, startDrive: p.startDrive, entries: p.entries, groups: p.groups };
}

const OPTIONS: LayoutOptions = {
  blocks: ["context", "model", "tools", "ask", "agents", "record"],
  boundaries: ["conversation-start", "input-received", "before-turn-end"],
  folded: new Set<string>(),
  dragging: null,
};

const ids = (profile: CanvasProfile, point: Parameters<typeof entriesAt>[1]): string[] =>
  entriesAt(profile, point).map((e) => e.plugin);

describe("cvD canvas model: profile edits", () => {
  test("a point lists the guard first, then profile order", () => {
    const dev = sample("dev");
    expect(ids(dev, "before:tools")).toEqual(["secret-guard", "commit-msg"]);
    expect(ids(dev, "feed:context")).toEqual(["memory", "house-style", "repo-skills"]);
    expect(ids(dev, "drive")).toEqual(["helm", "verifier"]);
  });

  test("placing inserts at the index within the point and keeps the guard ahead", () => {
    const dev = sample("dev");
    const placed = placePlugin(dev, "changelog", "feed:context", 1, false);
    expect(ids(placed, "feed:context")).toEqual([
      "memory",
      "changelog",
      "house-style",
      "repo-skills",
    ]);
    const hook = placePlugin(dev, "test-runner", "boundary:before-turn-end", 0, false);
    expect(ids(hook, "boundary:before-turn-end")).toEqual(["test-runner"]);
    expect(placed.startDrive).toBe("helm");
  });

  test("placing at a point the plugin cannot use changes nothing", () => {
    const dev = sample("dev");
    expect(placePlugin(dev, "changelog", "before:tools", 0, false)).toBe(dev);
  });

  test("a Drive dropped on the empty trunk head becomes the start Drive", () => {
    const blank = sample("blank");
    const placed = placePlugin(blank, "web-research", "drive", 0, true);
    expect(placed.startDrive).toBe("web-research");
    expect(hasPlugin(placed, "web-research")).toBe(true);
  });

  test("removing a base plugin is a no-op; removing a member leaves its group", () => {
    const dev = sample("dev");
    expect(removePlugin(dev, "secret-guard")).toBe(dev);
    const removed = removePlugin(dev, "lint-on-edit");
    expect(hasPlugin(removed, "lint-on-edit")).toBe(false);
    expect(removed.groups).toEqual([
      {
        id: "quality",
        name: "desktop.craft.canvas.cvD.sample.group.quality",
        members: ["verifier"],
      },
    ]);
    expect(removePlugin(dev, "helm").startDrive).toBeNull();
  });

  test("shift moves within the same tier only", () => {
    const dev = sample("dev");
    expect(ids(shiftPlugin(dev, "repo-skills", -1), "feed:context")).toEqual([
      "memory",
      "repo-skills",
      "house-style",
    ]);
    expect(shiftPlugin(dev, "repo-skills", 1)).toBe(dev);
    expect(ids(shiftPlugin(dev, "commit-msg", -1), "before:tools")).toEqual([
      "secret-guard",
      "commit-msg",
    ]);
  });
});

describe("cvD canvas model: layout", () => {
  test("only used hook rows are drawn while nothing is dragged", () => {
    const layout = layoutProfile(sample("dev"), OPTIONS);
    expect(layout.rows.filter((r) => r.kind === "hook").map((r) => r.key)).toEqual([
      "before:model",
      "before:tools",
      "after:tools",
    ]);
    expect(layout.rows.some((r) => r.ghost)).toBe(false);
  });

  test("chips on one point stand in call order, one column apart", () => {
    const layout = layoutProfile(sample("dev"), OPTIONS);
    const feed = layout.chips
      .filter((c) => c.point === "feed:context")
      .map((c) => [c.plugin, c.order, c.x]);
    expect(feed).toEqual([
      ["memory", 0, CHIP_X0],
      ["house-style", 1, CHIP_X0 + COL_STEP],
      ["repo-skills", 2, CHIP_X0 + 2 * COL_STEP],
    ]);
  });

  test("group members share the rightmost column and the handoff spans helm to verifier", () => {
    const layout = layoutProfile(sample("dev"), OPTIONS);
    const lint = layout.chips.find((c) => c.plugin === "lint-on-edit");
    const verifier = layout.chips.find((c) => c.plugin === "verifier");
    expect(lint?.group).toBe("quality");
    expect(lint?.x).toBe(verifier?.x);
    expect(layout.handoffs.map((h) => [h.from, h.to])).toEqual([["helm", "verifier"]]);
  });

  test("dragging a hook reveals its empty boundary row as a ghost with a slot", () => {
    const layout = layoutProfile(sample("dev"), { ...OPTIONS, dragging: "test-runner" });
    const row = layout.rows.find((r) => r.point === "boundary:before-turn-end");
    expect(row?.ghost).toBe(true);
    const slots = layout.slots.filter((s) => s.point === "boundary:before-turn-end");
    expect(slots.map((s) => s.index)).toEqual([0]);
    const slot = slots[0];
    if (slot === undefined) throw new Error("slot missing");
    expect(nearestSlot(layout.slots, slot.x + slot.w / 2, slot.y + slot.h / 2)?.key).toBe(slot.key);
    expect(nearestSlot(layout.slots, slot.x, slot.y + 400)?.point).not.toBe(
      "boundary:before-turn-end",
    );
  });

  test("a folded group hides its members", () => {
    const layout = layoutProfile(sample("dev"), { ...OPTIONS, folded: new Set(["quality"]) });
    const hidden = layout.chips
      .filter((c) => c.hidden)
      .map((c) => c.plugin)
      .toSorted();
    expect(hidden).toEqual(["lint-on-edit", "verifier"]);
    expect(layout.groups.map((g) => g.open)).toEqual([false]);
  });
});
