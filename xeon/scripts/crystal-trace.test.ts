import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { apartAt, BAKE_YAWS, chamfered, restHalfGap, solidsAt, studioOf } from "./crystal-bake.ts";
import {
  bevelNormal,
  crc32,
  encodePng,
  enterSolid,
  exitSolid,
  fresnel,
  refract,
  renderLayers,
  toStraight8,
  type Plane,
  type Solid,
} from "./crystal-trace.ts";
import { crystalShards } from "../apps/desktop/src/views/effects/crystal-geometry.ts";

/** 한 변 2인 정육면체(-1 ~ 1) */
const CUBE: Solid = [
  { n: [1, 0, 0], d: 1 },
  { n: [-1, 0, 0], d: 1 },
  { n: [0, 1, 0], d: 1 },
  { n: [0, -1, 0], d: 1 },
  { n: [0, 0, 1], d: 1 },
  { n: [0, 0, -1], d: 1 },
];
const round = (v: number): number => Math.round(v * 1e4) / 1e4;

test("fresnel: 4% at normal incidence into glass, total internal reflection past the critical angle", () => {
  expect([
    round(fresnel(1, 1, 1.5)),
    fresnel(Math.cos(1.2), 1.5, 1),
    round(fresnel(1, 1.5, 1.5)),
  ]).toEqual([0.04, 1, 0]);
});

test("refract keeps a ray along the normal and returns null under total internal reflection", () => {
  expect([
    refract([0, 0, -1], [0, 0, 1], 1 / 1.5),
    refract([0.9, 0, -0.4359], [0, 0, 1], 1.5),
  ]).toEqual([[0, 0, -1], null]);
});

test("a ray enters a convex solid at the near face and leaves at the far face", () => {
  const front = enterSolid(CUBE, [0, 0, 5], [0, 0, -1]);
  const back = exitSolid(CUBE, [0, 0, 1], [0, 0, -1]);
  expect([
    front?.t,
    front?.plane.n,
    back?.t,
    back?.plane.n,
    enterSolid(CUBE, [3, 0, 5], [0, 0, -1]),
  ]).toEqual([4, [0, 0, 1], 2, [0, 0, -1], null]);
});

test("the bevel normal leans toward the neighbouring face only near an edge", () => {
  const face: Plane | undefined = CUBE[4];
  if (face === undefined) throw new Error("the cube has a front face");
  const middle = bevelNormal(CUBE, face, [0, 0, 1], 0.1);
  const edge = bevelNormal(CUBE, face, [1, 0, 1], 0.1);
  expect([middle, edge.map(round)]).toEqual([
    [0, 0, 1],
    [round(Math.SQRT1_2), 0, round(Math.SQRT1_2)],
  ]);
});

test("straight alpha lifts the alpha to the brightest channel so a highlight is not clipped", () => {
  expect([
    ...toStraight8(new Float32Array([0.5, 0.25, 0, 0.5, 0.8, 0.2, 0.2, 0.4, 0, 0, 0, 0])),
  ]).toEqual([255, 128, 0, 128, 255, 64, 64, 204, 0, 0, 0, 0]);
});

test("the PNG encoder writes a valid header and image data that inflates back to the pixels", () => {
  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);
  const png = encodePng(2, 1, rgba);
  const view = new DataView(png.buffer, png.byteOffset);
  const idatLength = view.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  // Paeth 필터(4): 첫 px은 그대로, 둘째 px은 왼쪽과의 차
  expect([
    [...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""),
    view.getUint32(16),
    view.getUint32(20),
    view.getUint32(29) === crc32(png.subarray(12, 29)),
    [...raw],
  ]).toEqual(["PNG", 2, 1, true, [4, 10, 20, 30, 255, 30, 30, 30, 129]]);
});

test("every edge of a shard gets one chamfer plane and the baked shards keep the cut apart", () => {
  const [faces] = crystalShards(restHalfGap(28));
  const edges = faces.reduce((sum, face) => sum + face.v.length, 0) / 2;
  const solids = solidsAt(0, restHalfGap(28));
  expect([
    chamfered(faces).length,
    faces.length + edges,
    solids.length,
    BAKE_YAWS.map((yaw) => Math.hypot(...apartAt(yaw)) > 0.5),
    round(restHalfGap(28)),
  ]).toEqual([
    faces.length + edges,
    faces.length + edges,
    2,
    [true, true, true, true, true],
    0.1852,
  ]);
});

test("rendering puts each sample in the layer of the shard it hits first and leaves the rest transparent", () => {
  const right: Solid = CUBE.map((plane) => ({ n: plane.n, d: plane.d + plane.n[0] * 2 }));
  const left: Solid = CUBE.map((plane) => ({ n: plane.n, d: plane.d - plane.n[0] * 2 }));
  const layers = renderLayers([left, right], {
    size: 3,
    halfExtent: 4.5,
    ss: 1,
    glass: { ior: [1.5, 1.5, 1.5], absorb: [0, 0, 0], bevel: 0.01, bounces: 4 },
    env: () => ({ c: 0.5, bg: 0 }),
    backdrop: [0, 0, 0],
    exposure: 1,
  });
  // 가운데 줄: 왼쪽 px은 왼쪽 조각의 층에만, 오른쪽 px은 오른쪽 조각의 층에만 든다. 가운데는 두 층 다 비어 있다.
  // 바탕이 보이지 않는 환경이라 유리 px은 불투명하다
  const alpha = (layer: number, x: number): number =>
    round(layers[layer]?.px[(3 + x) * 4 + 3] ?? -1);
  expect([alpha(0, 0), alpha(0, 2), alpha(1, 0), alpha(1, 2), alpha(0, 1), alpha(1, 1)]).toEqual([
    1, 0, 0, 1, 0, 0,
  ]);
});

/** 칸 크기 하나의 스튜디오 세기 [몸 채움, 빛깔, 밝기] */
const pick = (theme: "dark" | "light", box: number): readonly number[] => {
  const s = studioOf(theme, box);
  return [s.veil, s.aurora, s.lift];
};

test("small boxes get a fuller, more tinted body than the 64 box so 14 and 20 px do not average to grey (lcMk4)", () => {
  expect([
    pick("dark", 28),
    pick("dark", 40),
    pick("dark", 64),
    pick("light", 40),
    pick("light", 64),
  ]).toEqual([
    [0.78, 1, 1.3],
    [0.78, 1, 1.3],
    [0.64, 0.95, 1.08],
    [0.72, 1, 0.9],
    [0.6, 1, 0.92],
  ]);
});
