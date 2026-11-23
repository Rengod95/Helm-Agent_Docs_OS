// cvZoom(AGE-31): 판의 높이가 배율 칸의 내용만큼 줄고 는다. 칸 표(판 높이와 판 사이), 경계의 늦춤, 칸마다 다시 잡은 배치(겹치지 않고
// 화면 간격이 고르다), 칸 사이를 섞는 값, 칸이 바뀔 때 붙드는 판의 자리를 값으로 본다.
import { describe, expect, test } from "bun:test";
import {
  holdAt,
  holdPoint,
  layoutProfile,
  plateHeightOf,
  TAB_ROOM,
  type Rect,
} from "../../../src/views/craft/canvas/cv6/layout.ts";
import {
  metricsOf,
  mixMetrics,
  NEAR_METRICS,
  stepOf,
} from "../../../src/views/craft/canvas/cv6/lod.ts";
import { attachProfile, profileFromSample } from "../../../src/views/craft/canvas/cv6/model.ts";

const STEPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** 칸마다 가장 낮은 배율: 첫 칸은 최소 확대, 나머지는 아래 경계보다 4% 아래 */
const LOWEST = [0.2, ...[0.24, 0.29, 0.37, 0.48, 0.6, 0.72].map((e) => e / 1.04)];

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const withTab = (r: Rect): Rect => ({ x: r.x, y: r.y - TAB_ROOM, w: r.w, h: r.h + TAB_ROOM });

describe("배율 칸", () => {
  test("칸은 여덟: 멀리 넷(0.2, 0.24, 0.29, 0.37), 중간 셋(0.48, 0.6, 0.72), 가까이 하나(0.85). 단계 경계는 그대로", () => {
    expect(
      [0.2, 0.23, 0.24, 0.3, 0.37, 0.47, 0.48, 0.6, 0.75, 0.84, 0.85, 1.8].map((z) =>
        stepOf(z, null),
      ),
    ).toEqual([0, 0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 7]);
    expect(STEPS.map((s) => metricsOf(s).lod)).toEqual([
      "far",
      "far",
      "far",
      "far",
      "mid",
      "mid",
      "mid",
      "near",
    ]);
  });

  test("올라갈 때는 경계에서 바로, 내려갈 때는 경계보다 4% 아래에서 바뀐다(경계에서 오가도 떨리지 않는다)", () => {
    expect([
      stepOf(0.48, 3),
      stepOf(0.47, 4),
      stepOf(0.462, 4),
      stepOf(0.461, 4),
      stepOf(0.85, 6),
      stepOf(0.83, 7),
      stepOf(0.81, 7),
      stepOf(0.3, 7),
    ]).toEqual([4, 4, 4, 3, 7, 7, 6, 2]);
  });
});

describe("칸 표", () => {
  test("판 높이: 멀리는 머리 한 줄(160 → 90), 중간은 이름, 목적, 안쪽 면(308 → 207), 가까이는 참고 그림 그대로(289, 적은 판 196)", () => {
    expect(STEPS.map((s) => [metricsOf(s).full, metricsOf(s).lean])).toEqual([
      [160, 160],
      [139, 139],
      [115, 115],
      [90, 90],
      [308, 186],
      [247, 150],
      [207, 125],
      [289, 196],
    ]);
  });

  test("멀리의 판은 칸의 가장 낮은 배율에서 화면 32(여백 8 + 줄 16 + 여백 8)다: 30%에서 34.5", () => {
    expect(LOWEST.slice(0, 4).map((z, s) => Math.floor(metricsOf(s).full * z))).toEqual([
      32, 32, 32, 32,
    ]);
    expect(metricsOf(stepOf(0.3, null)).full * 0.3).toBe(34.5);
  });

  test("판 사이는 칸의 가장 낮은 배율에서 화면으로 세로 32(탭 자리 빼고), 가로 24다. 가까이는 100%에서 같은 값(52, 24)", () => {
    const rows = STEPS.slice(0, 7).map((s) => {
      const m = metricsOf(s);
      const z = LOWEST[s] ?? 1;
      const rise = Math.min(36, Math.max(20, 17 / z));
      return [Math.round((m.stackGap - rise) * z), Math.round(m.colGap * z)];
    });
    expect(rows).toEqual(Array.from({ length: 7 }, () => [32, 24]));
    expect([NEAR_METRICS.stackGap, NEAR_METRICS.colGap]).toEqual([52, 24]);
  });

  test("두 칸을 섞으면 끝에서 각 칸의 값이고, 무엇을 보이나(단계)는 처음부터 새 칸이다", () => {
    const a = metricsOf(2);
    const b = metricsOf(4);
    expect([
      mixMetrics(a, b, 0).full,
      mixMetrics(a, b, 0.5).full,
      mixMetrics(a, b, 1).full,
      mixMetrics(a, b, 0).lod,
      mixMetrics(a, b, 2).full,
    ]).toEqual([115, 211.5, 308, "mid", 308]);
  });
});

describe("칸마다 다시 잡은 배치", () => {
  const scenes = [
    ["dev", profileFromSample("dev")],
    ["scale", profileFromSample("scale")],
    ["attach5", attachProfile(5)],
    ["attach20", attachProfile(20)],
  ] as const;

  test("묶음 밖의 판 높이는 그 칸의 값이고, 묶음 안의 판과 받침판은 칸의 온전한 높이를 따른다", () => {
    const l = layoutProfile(profileFromSample("dev"), new Set(), metricsOf(2));
    const loose = new Set(l.plates.filter((p) => p.inBundle === null).map((p) => p.h));
    const inBundle = new Set(l.plates.filter((p) => p.inBundle !== null).map((p) => p.h));
    const pedestals = l.bundles.filter((b) => !b.collapsed).map((b) => b.h);
    expect([[...loose], [...inBundle], pedestals.every((h) => h === 72 + 115 + 12)]).toEqual([
      [115],
      inBundle.size === 0 ? [] : [115],
      true,
    ]);
  });

  test("중간 칸의 판 높이는 목적과 설명이 있는지에 따라 준다(목적 없음 −53, 설명 없음 −69)", () => {
    const m = metricsOf(4);
    const l = layoutProfile(profileFromSample("dev"), new Set(), m);
    const wrong = l.plates
      .filter((p) => p.inBundle === null && p.h !== plateHeightOf(p.placed.plugin, m))
      .map((p) => p.placed.plugin.name);
    expect([wrong, m.full - m.noPurpose, m.full - m.noDescription]).toEqual([[], 255, 239]);
  });

  test("어느 칸에서도 탭 자리까지 넣은 판끼리 겹치지 않는다(개발, 30개, 한 자리 5·20)", () => {
    const hits = STEPS.flatMap((s) =>
      scenes.flatMap(([id, p]) => {
        const l = layoutProfile(p, new Set(), metricsOf(s));
        return l.plates.flatMap((a, i) =>
          l.plates
            .slice(i + 1)
            .flatMap((b) =>
              overlaps(withTab(a), withTab(b)) ? [`${s}:${id}:${a.placed.plugin.name}`] : [],
            ),
        );
      }),
    );
    expect(hits).toEqual([]);
  });

  test("판 30개: 30%의 배치는 100%보다 낮다(판이 줄어 루프가 납작해진다)", () => {
    const p = profileFromSample("scale");
    const far = layoutProfile(p, new Set(), metricsOf(stepOf(0.3, null)));
    const near = layoutProfile(p, new Set());
    expect([far.plates.length, far.bounds.h < near.bounds.h]).toEqual([30, true]);
  });
});

describe("칸이 바뀔 때 붙드는 판", () => {
  const p = profileFromSample("dev");
  const before = layoutProfile(p, new Set(), metricsOf(2));
  const after = layoutProfile(p, new Set(), metricsOf(4));

  test("판 안의 점은 높이에 대한 비율로, 판 밖의 점은 가까운 변에서의 거리로 따라간다", () => {
    const r = before.plates[0];
    if (r === undefined) throw new Error("표본에 판이 없다");
    const name = r.placed.plugin.name;
    const inside = holdAt(before, { x: r.x + 10, y: r.y + r.h / 4 });
    const below = holdAt(before, { x: r.x + 10, y: r.y + r.h + 5 });
    const moved = after.plates.find((q) => q.placed.plugin.name === name);
    if (inside === null || below === null || moved === undefined) throw new Error("붙들 판이 없다");
    expect([
      inside.name,
      holdPoint(after, inside),
      holdPoint(after, below),
      holdPoint(before, inside),
    ]).toEqual([
      name,
      { x: moved.x + 10, y: moved.y + moved.h / 4 },
      { x: moved.x + 10, y: moved.y + moved.h + 5 },
      { x: r.x + 10, y: r.y + r.h / 4 },
    ]);
  });

  test("판이 없으면 붙들지 않는다", () => {
    const bare = { ...before, plates: [] };
    expect([
      holdAt(bare, { x: 0, y: 0 }),
      holdPoint(bare, { name: "x", dx: 0, y: { at: "in", f: 0 } }),
    ]).toEqual([null, null]);
  });
});
