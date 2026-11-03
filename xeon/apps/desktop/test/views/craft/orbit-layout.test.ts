import { describe, expect, test } from "bun:test";
import {
  buildFixture,
  fitView,
  type CanvasPlugin,
  type CanvasSnapshot,
  type LayerKey,
} from "@fresnel/client/workbench/canvas";
import {
  ARC_LANE_GAP,
  GAP_DEG,
  MIN_CHORD,
  ORBIT_OUTER,
  angleAt,
  layoutOrbit,
  placementOrder,
  ringRadius,
  type OrbitDot,
} from "../../../src/views/craft/orbit-layout.ts";

function plugin(id: string, layer: LayerKey, group?: string): CanvasPlugin {
  return {
    id,
    name: id,
    layer,
    origin: "builtin",
    on: true,
    hooks: [],
    provides: [],
    pieces: [],
    ...(group === undefined ? {} : { group }),
  };
}

/** 소수 여섯 자리까지 같은지 본다(삼각함수 값은 정확한 소수가 아니라서) */
function expectPoint(d: OrbitDot | undefined, x: number, y: number): void {
  expect(d).toBeDefined();
  expect(d?.x).toBeCloseTo(x, 6);
  expect(d?.y).toBeCloseTo(y, 6);
}

describe("orbit layout: exact values", () => {
  // 고리 하나에 점이 하나면 아래(180도), 셋이면 빈 틈 양쪽 끝과 아래다
  const small: CanvasSnapshot = {
    plugins: [plugin("a", "L1"), plugin("b", "L2"), plugin("c", "L2", "g"), plugin("d", "L2")],
    groups: [{ id: "g", name: "g", version: "1.0.0", origin: "builtin", members: ["c"] }],
  };

  test("the model's OUTER radius is 460, the same constant the layout uses", () => {
    // 맞춤은 OUTER로 나누므로, 가장 바깥 고리가 1220px 칸에 배율 1로 들어가면 OUTER는 460이다
    expect(fitView({ w: 1220, h: 100000 }, { top: 0, right: 0, bottom: 0, left: 0 }, 150).k).toBe(
      1,
    );
    expect(ORBIT_OUTER).toBe(460);
  });

  test("ring radii are the fractions 0.28, 0.5, 0.71, 0.89 of OUTER", () => {
    expect(ringRadius("L1")).toBeCloseTo(128.8, 6);
    expect(ringRadius("L2")).toBeCloseTo(230, 6);
    expect(ringRadius("L3")).toBeCloseTo(326.6, 6);
    expect(ringRadius("plugin")).toBeCloseTo(409.4, 6);
  });

  test("angles: one point sits at the bottom, several spread between the top gap", () => {
    expect(GAP_DEG).toBe(24);
    expect(angleAt(0, 1)).toBe(180);
    expect(angleAt(0, 2)).toBe(24);
    expect(angleAt(1, 2)).toBe(336);
    expect(angleAt(0, 3)).toBe(24);
    expect(angleAt(1, 3)).toBe(180);
    expect(angleAt(2, 3)).toBe(336);
  });

  test("placement keeps group members next to each other, in snapshot order", () => {
    const withGroup: CanvasSnapshot = {
      plugins: [
        plugin("a", "L2"),
        plugin("c", "L2", "g"),
        plugin("b", "L2"),
        plugin("d", "L2", "g"),
      ],
      groups: [{ id: "g", name: "g", version: "1.0.0", origin: "builtin", members: ["c", "d"] }],
    };
    expect(placementOrder(withGroup).map((p) => p.id)).toEqual(["a", "c", "d", "b"]);
  });

  test("dots on each ring: exact coordinates on the small snapshot", () => {
    const layout = layoutOrbit(small);
    const byId = new Map(layout.dots.map((d) => [d.id, d] as const));
    // L1 한 점: 반지름 128.8, 아래
    expect(byId.get("a")?.ring).toBe("L1");
    expectPoint(byId.get("a"), 500, 628.8);
    // L2 셋: b 24도, c 180도, d 336도, 반지름 230
    expectPoint(byId.get("b"), 593.549428, 289.884545);
    expectPoint(byId.get("c"), 500, 730);
    expectPoint(byId.get("d"), 406.450572, 289.884545);
    expect(byId.get("b")?.angle).toBeCloseTo(24, 9);
    expect(byId.get("c")?.angle).toBeCloseTo(180, 9);
    expect(byId.get("d")?.angle).toBeCloseTo(336, 9);
  });

  test("group arc: from the first to the last member angle, padded by 4 degrees, on the outer radius", () => {
    const layout = layoutOrbit(small);
    expect(layout.arcs).toEqual([{ groupId: "g", from: 176, to: 184, radius: 460 }]);
  });

  test("an empty snapshot gives no dots and no arcs", () => {
    expect(layoutOrbit({ plugins: [], groups: [] })).toEqual({ dots: [], arcs: [] });
  });
});

describe("orbit layout: 77 plugins", () => {
  const snapshot = buildFixture(77);
  const layout = layoutOrbit(snapshot);
  const rings: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];
  const onRing = (r: LayerKey): OrbitDot[] =>
    layout.dots.filter((d) => d.ring === r).toSorted((a, b) => a.angle - b.angle);

  test("exact counts per ring: L1 8, L2 27, L3 24, plugin 18", () => {
    expect(layout.dots.length).toBe(77);
    expect(rings.map((r) => onRing(r).length)).toEqual([8, 27, 24, 18]);
  });

  test("every plugin gets exactly one dot", () => {
    expect(new Set(layout.dots.map((d) => d.id)).size).toBe(77);
    expect(layout.dots.map((d) => d.id).toSorted()).toEqual(
      snapshot.plugins.map((p) => p.id).toSorted(),
    );
  });

  test("no two dots on a ring are closer than the minimum chord", () => {
    expect(MIN_CHORD).toBe(44);
    for (const r of rings) {
      const ds = onRing(r);
      for (let i = 1; i < ds.length; i++) {
        const a = ds[i - 1];
        const b = ds[i];
        if (a === undefined || b === undefined) throw new Error("ring list has a hole");
        const chord = Math.hypot(a.x - b.x, a.y - b.y);
        expect(chord).toBeGreaterThanOrEqual(MIN_CHORD);
      }
    }
  });

  test("dots stay out of the top gap that the layer names sit in", () => {
    for (const d of layout.dots) {
      expect(d.angle).toBeGreaterThanOrEqual(GAP_DEG);
      expect(d.angle).toBeLessThanOrEqual(360 - GAP_DEG);
    }
  });

  test("the same snapshot always gives the same layout", () => {
    expect(layoutOrbit(buildFixture(77))).toEqual(layout);
  });

  test("members of one group are adjacent on every ring they sit on", () => {
    for (const g of snapshot.groups) {
      for (const r of rings) {
        const ds = onRing(r);
        const idx = ds.flatMap((d, i) => (g.members.includes(d.id) ? [i] : []));
        const first = idx[0];
        const last = idx[idx.length - 1];
        if (first === undefined || last === undefined) continue;
        expect(last - first + 1).toBe(idx.length);
      }
    }
  });

  test("every group arc covers all of its members' angles", () => {
    const angleOf = new Map(layout.dots.map((d) => [d.id, d.angle] as const));
    for (const arc of layout.arcs) {
      const g = snapshot.groups.find((x) => x.id === arc.groupId);
      if (g === undefined) throw new Error("arc without a group");
      for (const id of g.members) {
        const a = angleOf.get(id);
        if (a === undefined) continue;
        expect(a).toBeGreaterThanOrEqual(arc.from);
        expect(a).toBeLessThanOrEqual(arc.to);
      }
    }
  });

  test("arcs that overlap in angle are stacked on different radii; no two arcs share a lane and overlap", () => {
    const radii = new Set(layout.arcs.map((a) => a.radius));
    expect([...radii].toSorted((a, b) => a - b)).toEqual([ORBIT_OUTER, ORBIT_OUTER + ARC_LANE_GAP]);
    for (const r of radii) {
      const lane = layout.arcs.filter((a) => a.radius === r).toSorted((a, b) => a.from - b.from);
      for (let i = 1; i < lane.length; i++) {
        const prev = lane[i - 1];
        const cur = lane[i];
        if (prev === undefined || cur === undefined) throw new Error("lane has a hole");
        expect(cur.from).toBeGreaterThanOrEqual(prev.to);
      }
    }
  });
});
