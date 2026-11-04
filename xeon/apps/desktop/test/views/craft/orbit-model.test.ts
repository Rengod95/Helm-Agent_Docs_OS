import { describe, expect, test } from "bun:test";
import {
  FIXTURE_ORDER,
  buildFixture,
  type CanvasPlugin,
  type CanvasSnapshot,
} from "@fresnel/client/workbench/canvas";
import {
  groupOnCount,
  isDimmed,
  layerPlugins,
  litOf,
  matchesQuery,
  passesFilter,
} from "../../../src/views/craft/orbit-model.ts";

const fixture = buildFixture(77);
const byId = (id: string): CanvasPlugin => {
  const p = fixture.plugins.find((x) => x.id === id);
  if (p === undefined) throw new Error(`fixture has no ${id}`);
  return p;
};

describe("orbit model: lighting the selection", () => {
  test("nothing selected lights nothing and dims nothing", () => {
    const lit = litOf({ k: "agent" }, fixture, FIXTURE_ORDER);
    expect(lit.active).toBe(false);
    expect(lit.primary).toBeNull();
    expect([...lit.ids]).toEqual([]);
  });

  test("a plugin in a group lights the whole group, and names the plugin as primary", () => {
    const lit = litOf({ k: "plugin", id: "helm/explore" }, fixture, FIXTURE_ORDER);
    expect(lit.primary).toBe("helm/explore");
    expect([...lit.ids].toSorted()).toEqual(["helm", "helm/explore", "helm/panel"]);
    expect(lit.active).toBe(true);
  });

  test("a single plugin lights only itself", () => {
    const lit = litOf({ k: "plugin", id: "web" }, fixture, FIXTURE_ORDER);
    expect([...lit.ids]).toEqual(["web"]);
  });

  test("a group lights its members and has no primary", () => {
    const lit = litOf({ k: "group", id: "learning" }, fixture, FIXTURE_ORDER);
    expect(lit.primary).toBeNull();
    expect([...lit.ids].toSorted()).toEqual(["learning", "learning/ledger"]);
  });

  test("a layer lights the plugins on that layer", () => {
    const small: CanvasSnapshot = {
      plugins: [byId("cost-router"), byId("web"), byId("compact-keep")],
      groups: [],
    };
    const lit = litOf({ k: "layer", id: "L1" }, small, {});
    expect([...lit.ids].toSorted()).toEqual(["compact-keep", "cost-router"]);
  });

  test("a hook row lights the plugins in its applied order", () => {
    const lit = litOf({ k: "hook", id: "tool.call.before" }, fixture, FIXTURE_ORDER);
    expect([...lit.ids].toSorted()).toEqual(["helm", "secret-scan"]);
  });

  test("a builtin slot lights nothing and does not count as a selection", () => {
    const lit = litOf({ k: "builtin", slot: "hook:thread.compact.before" }, fixture, FIXTURE_ORDER);
    expect(lit.active).toBe(false);
  });
});

describe("orbit model: filters and finder", () => {
  const helmExplore = byId("helm/explore");
  const web = byId("web");

  test("kind filter keeps only the kind asked for", () => {
    expect(passesFilter(helmExplore, "group", [])).toBe(true);
    expect(passesFilter(helmExplore, "single", [])).toBe(false);
    expect(passesFilter(web, "single", [])).toBe(true);
    expect(passesFilter(byId("exa"), "external", [])).toBe(true);
    expect(passesFilter(web, "all", [])).toBe(true);
  });

  test("contribution filter keeps plugins that give any of the chosen kinds", () => {
    // helm/explore는 도구·보조 에이전트·스킬을 준다. web은 도구만 준다
    expect(passesFilter(helmExplore, "all", ["skill"])).toBe(true);
    expect(passesFilter(web, "all", ["skill"])).toBe(false);
    expect(passesFilter(web, "all", ["skill", "tool"])).toBe(true);
    expect(passesFilter(byId("cost-router"), "all", ["hook"])).toBe(true);
    expect(passesFilter(web, "all", ["hook"])).toBe(false);
  });

  test("the finder matches name, one-line role, hook id, capability and piece name, ignoring case and spaces", () => {
    expect(matchesQuery(helmExplore, "EXPLORE")).toBe(true);
    expect(matchesQuery(helmExplore, "  inquiry ")).toBe(true);
    expect(matchesQuery(helmExplore, "lens_search")).toBe(true);
    expect(matchesQuery(byId("cost-router"), "request.provider")).toBe(true);
    expect(matchesQuery(web, "explore")).toBe(false);
    expect(matchesQuery(web, "   ")).toBe(true);
    expect(matchesQuery(web, "")).toBe(true);
  });

  test("a dot is dimmed when it is outside the selection, filtered out, or not found", () => {
    const lit = litOf({ k: "plugin", id: "helm/explore" }, fixture, FIXTURE_ORDER);
    expect(isDimmed(helmExplore, lit, "all", [], "")).toBe(false);
    expect(isDimmed(web, lit, "all", [], "")).toBe(true);
    expect(isDimmed(helmExplore, lit, "single", [], "")).toBe(true);
    expect(isDimmed(helmExplore, lit, "all", [], "zzz-no-match")).toBe(true);
    const none = litOf({ k: "agent" }, fixture, FIXTURE_ORDER);
    expect(isDimmed(web, none, "all", [], "")).toBe(false);
  });
});

describe("orbit model: layer panel order and counts", () => {
  test("layerPlugins keeps snapshot order on one layer", () => {
    const small: CanvasSnapshot = {
      plugins: [byId("secret-scan"), byId("web"), byId("exa"), byId("lint-on-edit")],
      groups: [],
    };
    expect(layerPlugins(small, "plugin", []).map((p) => p.id)).toEqual([
      "secret-scan",
      "exa",
      "lint-on-edit",
    ]);
  });

  test("groupOnCount counts members that are really on (auto-off counts as off)", () => {
    expect(groupOnCount(fixture, "helm")).toEqual({ on: 3, total: 3 });
    // review: 구성원 둘 가운데 하나는 연속 실패로 자동 꺼졌다
    expect(groupOnCount(fixture, "review")).toEqual({ on: 1, total: 2 });
    expect(groupOnCount(fixture, "no-such-group")).toEqual({ on: 0, total: 0 });
  });
});
