import { describe, expect, test } from "bun:test";
import {
  applyToggle,
  clearSel,
  isOn,
  selectGroup,
  selectPlugin,
  toggleTargets,
  type SelState,
} from "../../../src/workbench/canvas/select.ts";
import type { CanvasSnapshot } from "../../../src/workbench/canvas/types.ts";
import { MOCK, plugin } from "./support.ts";

/** 켜짐 판정이 꺼진 플러그인의 id들(스냅샷 순서) */
const offIds = (snap: CanvasSnapshot): string[] =>
  snap.plugins.filter((p) => !isOn(p)).map((p) => p.id);

describe("selection", () => {
  test("selecting a plugin or a group opens the panel unless asked not to", () => {
    const opened: SelState = selectPlugin("helm");
    expect(opened).toEqual({ sel: { k: "plugin", id: "helm" }, panel: true });
    expect(selectPlugin("helm", false)).toEqual({ sel: { k: "plugin", id: "helm" }, panel: false });
    expect(selectGroup("review")).toEqual({ sel: { k: "group", id: "review" }, panel: true });
  });

  test("clearing goes back to the agent with the panel closed", () => {
    expect(clearSel()).toEqual({ sel: { k: "agent" }, panel: false });
  });
});

describe("on state", () => {
  test("a plugin is on when its switch is on and it was not auto-disabled", () => {
    expect(isOn(plugin(MOCK, "helm"))).toEqual(true);
    expect(isOn(plugin(MOCK, "exa"))).toEqual(false);
    // review 스위치는 켜져 있지만 연속 실패 5번으로 자동 꺼졌다
    expect(plugin(MOCK, "review").on).toEqual(true);
    expect(isOn(plugin(MOCK, "review"))).toEqual(false);
  });

  test("the mock starts with review, exa and compact-keep off", () => {
    expect(offIds(MOCK)).toEqual(["review", "exa", "compact-keep"]);
  });
});

describe("toggleTargets", () => {
  test("a grouped plugin, or a group id, targets the whole group", () => {
    expect(toggleTargets(MOCK, "helm/explore")).toEqual(["helm", "helm/explore", "helm/panel"]);
    expect(toggleTargets(MOCK, "learning/ledger")).toEqual(["learning", "learning/ledger"]);
    expect(toggleTargets(MOCK, "review")).toEqual(["review", "review/lens"]);
    expect(toggleTargets(MOCK, "review/lens")).toEqual(["review", "review/lens"]);
  });

  test("a single plugin targets only itself, an unknown id targets nothing", () => {
    expect(toggleTargets(MOCK, "web")).toEqual(["web"]);
    expect(toggleTargets(MOCK, "no-such-plugin")).toEqual([]);
  });
});

describe("applyToggle", () => {
  test("switching one member off switches the whole group off and leaves the input as it was", () => {
    const next = applyToggle(MOCK, "helm/explore", false);
    expect(offIds(next)).toEqual([
      "helm",
      "helm/explore",
      "helm/panel",
      "review",
      "exa",
      "compact-keep",
    ]);
    expect(offIds(MOCK)).toEqual(["review", "exa", "compact-keep"]);
    expect(next.groups).toBe(MOCK.groups);
  });

  test("switching a single plugin changes only that plugin", () => {
    const next = applyToggle(MOCK, "exa", true);
    expect(offIds(next)).toEqual(["review", "compact-keep"]);
    expect(plugin(next, "web")).toEqual(plugin(MOCK, "web"));
  });

  test("switching a group back on clears its auto-disable record and only that", () => {
    const next = applyToggle(MOCK, "review/lens", true);
    expect(offIds(next)).toEqual(["exa", "compact-keep"]);
    expect(Object.hasOwn(plugin(next, "review"), "health")).toEqual(false);
    expect(plugin(next, "review").on).toEqual(true);
    // 자동 꺼짐이 없던 플러그인의 실패 기록은 그대로다
    expect(plugin(next, "acme-notes").health?.fails).toEqual(2);
    // 입력의 기록은 그대로다
    expect(plugin(MOCK, "review").health?.fails).toEqual(5);
  });
});
