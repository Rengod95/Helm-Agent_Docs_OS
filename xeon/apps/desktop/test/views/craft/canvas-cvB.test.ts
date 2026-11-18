// cvB(유리·크리스탈) 프로필 캔버스의 모델과 배치: 자리 안의 순서(가드 먼저), 넣기·빼기·순서 바꾸기, 핸드오프,
// 캔버스 배치(겹침 없음, 묶음 접힘·펼침, 끌어 놓는 빈 자리), 플러그인 내부 배치(helm의 단계 고리, repo-skills의 스킬).
import { describe, expect, test } from "bun:test";
import { layoutInside } from "../../../src/views/craft/canvas/cvB/inside-layout.ts";
import {
  layoutProfile,
  type Box,
  type Layout,
} from "../../../src/views/craft/canvas/cvB/layout.ts";
import {
  addPlugin,
  dropTarget,
  handoffsOf,
  movePlugin,
  orderAt,
  removePlugin,
  type CvbPlugin,
  type ProfileState,
} from "../../../src/views/craft/canvas/cvB/model.ts";
import {
  EMPTY_PROFILE,
  SAMPLE_CATALOG,
  SAMPLE_PROFILE,
} from "../../../src/views/craft/canvas/cvB/sample.ts";

function expectOk(change: ReturnType<typeof addPlugin>): ProfileState {
  if (!change.ok) throw new Error(`refused: ${change.reason}`);
  return change.state;
}

function plugin(id: string): CvbPlugin {
  const found = SAMPLE_CATALOG.get(id);
  if (found === undefined) throw new Error(`no sample plugin ${id}`);
  return found;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function crystals(
  layout: Layout,
): readonly { readonly id: string; readonly box: Box; readonly group: string | null }[] {
  return layout.nodes.flatMap((n) =>
    n.type === "crystal" ? [{ id: n.id, box: n.box, group: n.group }] : [],
  );
}

const OPEN = new Set(["quality"]);

describe("model", () => {
  test("a place calls guards first, then the profile order", () => {
    expect(orderAt(SAMPLE_PROFILE, SAMPLE_CATALOG, "tools:before")).toEqual([
      "secret-guard",
      "commit-msg",
    ]);
    expect(orderAt(SAMPLE_PROFILE, SAMPLE_CATALOG, "context:feed")).toEqual([
      "memory",
      "house-style",
      "repo-skills",
    ]);
    // 가드가 목록 뒤에 있어도 먼저다
    const late: ProfileState = {
      ...SAMPLE_PROFILE,
      entries: [
        { plugin: "commit-msg", base: false },
        { plugin: "secret-guard", base: false },
      ],
    };
    expect(orderAt(late, SAMPLE_CATALOG, "tools:before")).toEqual(["secret-guard", "commit-msg"]);
  });

  test("moving inside a place swaps neighbours and never crosses the guard tier", () => {
    const moved = expectOk(movePlugin(SAMPLE_PROFILE, SAMPLE_CATALOG, "house-style", -1));
    expect(orderAt(moved, SAMPLE_CATALOG, "context:feed")).toEqual([
      "house-style",
      "memory",
      "repo-skills",
    ]);
    expect(movePlugin(SAMPLE_PROFILE, SAMPLE_CATALOG, "commit-msg", -1)).toEqual({
      ok: false,
      reason: "tier",
    });
    expect(movePlugin(SAMPLE_PROFILE, SAMPLE_CATALOG, "repo-skills", 1)).toEqual({
      ok: false,
      reason: "edge",
    });
  });

  test("a plugin drops only on the place it declares, and only once", () => {
    expect(dropTarget(SAMPLE_PROFILE, SAMPLE_CATALOG, "test-runner")).toBe(
      "boundary:before-turn-end",
    );
    expect(dropTarget(SAMPLE_PROFILE, SAMPLE_CATALOG, "web-research")).toBe("drive");
    expect(dropTarget(SAMPLE_PROFILE, SAMPLE_CATALOG, "helm")).toBeNull();
    const added = expectOk(addPlugin(SAMPLE_PROFILE, SAMPLE_CATALOG, "changelog"));
    expect(orderAt(added, SAMPLE_CATALOG, "context:feed")).toEqual([
      "memory",
      "house-style",
      "repo-skills",
      "changelog",
    ]);
    expect(addPlugin(added, SAMPLE_CATALOG, "changelog")).toEqual({ ok: false, reason: "present" });
  });

  test("base plugins stay; removing a group member also leaves its group and handoffs", () => {
    expect(removePlugin(SAMPLE_PROFILE, "memory")).toEqual({ ok: false, reason: "base" });
    expect(handoffsOf(SAMPLE_PROFILE, SAMPLE_CATALOG)).toEqual([
      { from: "helm", to: "verifier", back: true },
    ]);
    const removed = expectOk(removePlugin(SAMPLE_PROFILE, "verifier"));
    expect(removed.groups).toEqual([
      {
        id: "quality",
        title: { id: "desktop.craft.canvas.cvB.sample.quality" },
        members: ["lint-on-edit"],
      },
    ]);
    expect(handoffsOf(removed, SAMPLE_CATALOG)).toEqual([]);
    const noStart = expectOk(removePlugin(SAMPLE_PROFILE, "helm"));
    expect(noStart.startDrive).toBeNull();
  });
});

describe("canvas layout", () => {
  test("every plugin of the profile is one crystal, members inside the open group, and none overlap", () => {
    const layout = layoutProfile({
      state: SAMPLE_PROFILE,
      catalog: SAMPLE_CATALOG,
      open: OPEN,
      ghost: null,
      selected: null,
    });
    const found = crystals(layout);
    expect(found.map((c) => c.id).toSorted()).toEqual(
      SAMPLE_PROFILE.entries.map((e) => e.plugin).toSorted(),
    );
    expect(found.filter((c) => c.group === "quality").map((c) => c.id)).toEqual([
      "lint-on-edit",
      "verifier",
    ]);
    const boxes = layout.nodes
      .filter((n) => n.type === "crystal" || n.type === "station")
      .map((n) => n.box);
    const pairs = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlaps(a, b)));
    expect(pairs).toEqual([]);
  });

  test("a closed group is one node: its members are not drawn but the handoff beam still lands on it", () => {
    const layout = layoutProfile({
      state: SAMPLE_PROFILE,
      catalog: SAMPLE_CATALOG,
      open: new Set(),
      ghost: null,
      selected: null,
    });
    const ids = new Set(crystals(layout).map((c) => c.id));
    expect(ids.has("verifier")).toBe(false);
    expect(ids.has("lint-on-edit")).toBe(false);
    const group = layout.nodes.find((n) => n.type === "group");
    const beam = layout.lines.find((l) => l.kind === "beam");
    expect(group?.type === "group" && group.open).toBe(false);
    expect(beam?.kind === "beam" && group !== undefined ? beam.end.x : null).toBe(
      group?.box.x ?? 0,
    );
  });

  test("attachments are rods, handoffs are beams: one beam for helm → verifier", () => {
    const layout = layoutProfile({
      state: SAMPLE_PROFILE,
      catalog: SAMPLE_CATALOG,
      open: OPEN,
      ghost: null,
      selected: null,
    });
    expect(layout.lines.filter((l) => l.kind === "beam").map((l) => l.id)).toEqual([
      "beam:helm:verifier",
    ]);
    expect(layout.lines.filter((l) => l.kind === "track").length).toBe(1);
    expect(layout.lines.filter((l) => l.kind === "rod").length).toBe(6);
  });

  test("dragging shows a hollow place at the end of the target stack and lights the target", () => {
    const layout = layoutProfile({
      state: SAMPLE_PROFILE,
      catalog: SAMPLE_CATALOG,
      open: OPEN,
      ghost: "test-runner",
      selected: null,
    });
    const ghost = layout.nodes.find((n) => n.id === "ghost:test-runner");
    expect(ghost?.type === "crystal" && ghost.ghost).toBe(true);
    const targets = layout.nodes.flatMap((n) =>
      (n.type === "station" || n.type === "gate" || n.type === "zone") && n.target ? [n.id] : [],
    );
    expect(targets).toEqual(["gate:before-turn-end"]);
  });

  test("an empty profile keeps the six blocks and three boundaries and marks the Drive place empty", () => {
    const layout = layoutProfile({
      state: EMPTY_PROFILE,
      catalog: SAMPLE_CATALOG,
      open: OPEN,
      ghost: null,
      selected: null,
    });
    expect(layout.nodes.filter((n) => n.type === "station").length).toBe(6);
    expect(layout.nodes.filter((n) => n.type === "gate").length).toBe(3);
    expect(layout.nodes.some((n) => n.type === "zone" && n.empty)).toBe(true);
    expect(crystals(layout)).toEqual([]);
  });
});

describe("inside layout", () => {
  test("helm draws its own ring: three steps, a handoff port, and verifier outside with a beam", () => {
    const layout = layoutInside(plugin("helm"), SAMPLE_PROFILE, SAMPLE_CATALOG);
    expect(layout.nodes.flatMap((n) => (n.type === "step" ? [n.part.id] : []))).toEqual([
      "diverge",
      "explore",
      "apply",
    ]);
    expect(layout.nodes.flatMap((n) => (n.type === "port" ? [`${n.dir}:${n.other}`] : []))).toEqual(
      ["out:verifier"],
    );
    expect(layout.nodes.flatMap((n) => (n.type === "ghostPlugin" ? [n.plugin.id] : []))).toEqual([
      "verifier",
    ]);
    expect(layout.lines.filter((l) => l.kind === "beam").length).toBe(1);
  });

  test("repo-skills has no code: six skills, a permission, and a rod to context assembly", () => {
    const layout = layoutInside(plugin("repo-skills"), SAMPLE_PROFILE, SAMPLE_CATALOG);
    const parts = layout.nodes.flatMap((n) => (n.type === "part" ? [n.part.kind] : []));
    expect(parts).toEqual(["skill", "skill", "skill", "skill", "skill", "skill", "permission"]);
    expect(layout.nodes.filter((n) => n.type === "step").length).toBe(0);
    const station = layout.nodes.find((n) => n.type === "ghostStation");
    expect(station?.type === "ghostStation" ? station.anchor : null).toEqual({
      at: "block",
      block: "context",
      side: "feed",
    });
  });
});
