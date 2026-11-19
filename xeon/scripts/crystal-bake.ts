// 크리스탈 표시 굽기(DP-223, lcMk3): 갈라진 유리 두 조각을 crystal-trace.ts로 광선 추적해 스프라이트 판(PNG)과 그 배치표(TS)를 만든다.
// 화면은 이 판을 캔버스에 겹쳐 그리기만 한다(crystal-mark.tsx): 쉬는 상태 비용이 없고 작은 칸에서도 렌더링한 유리 그대로다.
//
//   just desktop-crystal-bake                         앱의 판 둘(다크·라이트)과 배치표를 다시 만든다
//   just desktop-crystal-bake --boxes 256 --out <폴더>  견본용 큰 판만(배치표 없음)
//
// 판 하나(테마 하나)는 줄마다 칸 크기(기기 px) 하나, 칸마다 요(y축 돌림) 한 자세의 조각 하나다(자세 × 조각 2). 두 조각을 따로 구워
// 화면이 틈을 따라 따로 옮긴다(가리킴·급함·누름·들고 남). 요 사이는 이웃 두 장을 섞는다. 같은 입력이면 같은 그림이다(난수 없음).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CRYSTAL_CUT_N,
  CRYSTAL_RADIUS,
  crystalShards,
  rotate,
  type CrystalFace,
} from "../apps/desktop/src/views/effects/crystal-geometry.ts";
import {
  dot,
  encodePng,
  renderLayers,
  studio,
  toStraight8,
  unit,
  type Glass,
  type Plane,
  type Shot,
  type Solid,
  type Studio,
  type V3,
} from "./crystal-trace.ts";

/** 쉬는 자세의 각(lcMk 시안 "확인 필요"): 요, 피치, 롤 */
const BASE_YAW = -0.45;
const PITCH = 0.3;
const ROLL = -0.26;
/** 구워 두는 요(쉬는 자세에서 더 돈 각). 나감 −0.25, 쉼 0, 가리킴 0.14, 들어옴 0.6 사이를 섞어 잇는다 */
export const BAKE_YAWS: readonly number[] = [-0.25, 0, 0.14, 0.35, 0.6];
/** 칸 반지름 대비 결정 반지름(튐 ×1.08에도 칸을 넘지 않는다) */
const FILL = 0.44;
/** 칸 반 변이 덮는 모형 거리 */
export const HALF_EXTENT: number = CRYSTAL_RADIUS / (2 * FILL);
/** 앱의 칸(기기 px): 14px@2x, 20px@2x, 그 위(3x·앱 배율)는 64에서 줄인다 */
const APP_BOXES: readonly number[] = [28, 40, 64];

/** 칸 크기마다 쉬는 틈의 반폭(모형 단위). 14·20 CSS px에서 틈이 약 1.9px이다(lcMk2와 같음) */
export function restHalfGap(box: number): number {
  const css = box <= 28 ? 14 : box <= 40 ? 20 : 17;
  const unitCss = (css * FILL) / CRYSTAL_RADIUS;
  return (1.3 * 1.48) / unitCss / 2;
}

/** 맑은 유리: 빛깔마다 굴절률이 조금씩 달라 날에 옅은 무지개가 선다(lcMk4가 분산을 넓혔다). 흡수는 넷째 판의 반으로 줄여 거의 무색이다(lcMk5) */
const GLASS: Omit<Glass, "bevel"> = {
  ior: [1.494, 1.512, 1.532],
  absorb: [0.02, 0.01, 0],
  bounces: 7,
};

export type Theme = "dark" | "light";

/** 테마 바탕색(caustic bg-app: 다크 oklch 0.135, 라이트 0.975). 빛깔이 든 투과분을 색에 접을 때만 쓴다 */
const BACKDROP: Readonly<Record<Theme, V3>> = {
  dark: [0.07, 0.07, 0.07],
  light: [0.965, 0.965, 0.965],
};

/** 작은 칸(14·20 CSS px의 2x 판)으로 보는 칸 한 변의 상한(기기 px) */
const SMALL_BOX = 40;

/**
 * 테마·칸 크기마다 스튜디오(lcMk5 [결정: 2026-11-19 사용자 "앱 아이콘처럼 더 투명하고 반짝이게"]). 넷째 판의 뿌연 몸은 뒤에서 비스듬히 오는
 * 가장자리 빛(rim)과 넓은 빛이 꺾여 나간 광선마다 실려 면을 채운 탓이었다. 그래서 면은 맑게 비우고(veil·rim·soft를 낮추고, 앞쪽 방의
 * `open`만큼 앱 바탕이 비친다) 빛은 날의 작은 정반사 점(spark)과 안쪽의 가는 띠(lines)에 모은다.
 * 작은 칸(14·20px의 2x 판)은 줄이지 않고 따로 맞춘다: 다크는 날 위 한두 점이 칸 하나를 채울 만큼 반짝임을 더 올리고, 라이트는 흰 바탕에서
 * 모양이 사라지지 않게 몸을 조금 더 채우고 방을 낮춰 날이 청회로 선다
 */
export function studioOf(theme: Theme, box: number): Studio {
  const small = box <= SMALL_BOX;
  if (theme === "dark") {
    return small
      ? {
          dark: true,
          veil: 0.25,
          aurora: 1,
          lift: 1.5,
          room: 0.8,
          open: 0.8,
          soft: 0.25,
          rim: 0.5,
          spark: 4.5,
          lines: 1.5,
        }
      : {
          dark: true,
          veil: 0.25,
          aurora: 1,
          lift: 1.2,
          room: 0.8,
          open: 0.9,
          soft: 0.2,
          rim: 0.5,
          spark: 2.5,
          lines: 1.2,
        };
  }
  return small
    ? {
        dark: false,
        veil: 0.6,
        aurora: 1,
        lift: 0.55,
        room: 0.5,
        open: 0,
        soft: 0.45,
        rim: 0.1,
        spark: 3.4,
        lines: 1.4,
      }
    : {
        dark: false,
        veil: 0.2,
        aurora: 1,
        lift: 0.75,
        room: 0.7,
        open: 0.35,
        soft: 0.6,
        rim: 0.1,
        spark: 2,
        lines: 1,
      };
}

/** 노출(빛 → 0~1로 접는 세기). 다크의 작은 칸은 더 밝게, 라이트의 작은 칸은 날이 하얗게 날아가지 않게 조금 낮게 접는다 */
function exposureOf(theme: Theme, box: number): number {
  if (theme === "light") return box <= SMALL_BOX ? 1.25 : 1.4;
  return box <= SMALL_BOX ? 1.6 : 1.45;
}

/** 모서리를 깎는 깊이(모형 단위). 앱 아이콘의 결정처럼 모든 모서리에 좁은 면이 하나씩 생겨 빛을 받는다 */
const CHAMFER = 0.018;

const same = (a: V3, b: V3): boolean =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-5;

/** 조각 하나의 평면들: 면마다 하나, 이웃한 두 면(꼭짓점 둘을 나눔)의 모서리마다 깎은 면 하나 */
export function chamfered(faces: readonly CrystalFace[]): Plane[] {
  const planes: Plane[] = faces.flatMap((face) => {
    const first = face.v[0];
    return first === undefined ? [] : [{ n: face.n, d: dot(face.n, first) }];
  });
  faces.forEach((a, i) => {
    for (const b of faces.slice(i + 1)) {
      const shared = a.v.filter((p) => b.v.some((q) => same(p, q)));
      const edge = shared[0];
      if (shared.length < 2 || edge === undefined) continue;
      const n = unit([a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]]);
      planes.push({ n, d: dot(n, edge) - CHAMFER });
    }
  });
  return planes;
}

const turn = (p: V3, yaw: number): V3 => rotate(p, BASE_YAW + yaw, PITCH, ROLL);

/** 요 하나의 두 조각(돌린 평면들) */
export function solidsAt(yaw: number, half: number): Solid[] {
  return crystalShards(half).map((faces) =>
    chamfered(faces).map((plane) => {
      const n = turn(plane.n, yaw);
      // 평면 위의 한 점(원점에서 법선 쪽으로 d)을 돌려 새 d를 얻는다
      return {
        n,
        d: dot(n, turn([plane.n[0] * plane.d, plane.n[1] * plane.d, plane.n[2] * plane.d], yaw)),
      };
    }),
  );
}

/** 조각 0이 틈을 여는 화면 방향(갈라진 면 법선의 화면 성분, 캔버스 y는 아래로). 길이는 3차원 1만큼 옮길 때의 화면 길이다 */
export function apartAt(yaw: number): readonly [number, number] {
  const n = rotate(CRYSTAL_CUT_N, BASE_YAW + yaw, PITCH, ROLL);
  return [n[0], -n[1]];
}

/** 한 칸 크기·테마의 굽기 설정 */
export function shotOf(box: number, theme: Theme): Shot {
  const unitPx = box / 2 / HALF_EXTENT;
  return {
    size: box,
    halfExtent: HALF_EXTENT,
    ss: box <= 40 ? 8 : box <= 64 ? 6 : 3,
    // 둥근 날은 화면에서 약 1px(작은 칸은 1.3px: 날의 반짝임이 한 px을 넘어 선으로 읽힌다)
    glass: { ...GLASS, bevel: Math.max(0.05, (box <= SMALL_BOX ? 1.3 : 1.1) / unitPx) },
    env: studio(studioOf(theme, box)),
    backdrop: BACKDROP[theme],
    exposure: exposureOf(theme, box),
  };
}

/** 한 칸 크기의 판 한 줄(조각마다 곧은 RGBA): 자세 × 조각 2 */
function bakeRow(box: number, theme: Theme): Uint8Array[] {
  const shot = shotOf(box, theme);
  return BAKE_YAWS.flatMap((yaw) =>
    renderLayers(solidsAt(yaw, restHalfGap(box)), shot).map((layer) => toStraight8(layer.px)),
  );
}

/** 판 하나: 줄마다 칸 크기 하나, 줄 안에 칸들이 왼쪽부터 */
function bakeSheet(
  boxes: readonly number[],
  theme: Theme,
): { readonly width: number; readonly height: number; readonly png: Uint8Array } {
  const cells = BAKE_YAWS.length * 2;
  const width = Math.max(...boxes) * cells;
  const height = boxes.reduce((sum, box) => sum + box, 0);
  const rgba = new Uint8Array(width * height * 4);
  let top = 0;
  for (const box of boxes) {
    bakeRow(box, theme).forEach((cell, k) => {
      for (let y = 0; y < box; y++) {
        const from = y * box * 4;
        rgba.set(cell.subarray(from, from + box * 4), ((top + y) * width + k * box) * 4);
      }
    });
    top += box;
  }
  return { width, height, png: encodePng(width, height, rgba) };
}

const fixed = (v: number): string => String(Number(v.toFixed(4)));

/** 배치표(crystal-sheet.ts) 원문 */
function sheetModule(boxes: readonly number[], width: number, height: number): string {
  const rows = boxes.map((box, i) => {
    const top = boxes.slice(0, i).reduce((sum, b) => sum + b, 0);
    return `    { box: ${String(box)}, top: ${String(top)}, half: ${fixed(restHalfGap(box))} },`;
  });
  const apart = BAKE_YAWS.map((yaw) => {
    const [x, y] = apartAt(yaw);
    return `    [${fixed(x)}, ${fixed(y)}],`;
  });
  return [
    "// 이 파일은 scripts/crystal-bake.ts가 만든다(`just desktop-crystal-bake`). 손으로 고치지 않는다.",
    "// 크리스탈 표시의 스프라이트 판(crystal-dark.png, crystal-light.png) 배치표(DP-223, lcMk3).",
    "",
    "/** 판의 줄 하나: 칸 한 변(기기 px), 판 안의 윗변, 쉬는 틈의 반폭(모형 단위) */",
    "export interface CrystalSheetRow {",
    "  readonly box: number;",
    "  readonly top: number;",
    "  readonly half: number;",
    "}",
    "",
    "/** 판 배치. 칸 k(0부터)는 자세 floor(k / 2)의 조각 k % 2이고 왼쪽에서 k × box에 있다 */",
    "export const CRYSTAL_SHEET: {",
    "  readonly width: number;",
    "  readonly height: number;",
    "  readonly rows: readonly CrystalSheetRow[];",
    "  readonly yaws: readonly number[];",
    "  readonly apart: readonly (readonly [number, number])[];",
    "  readonly halfExtent: number;",
    "} = {",
    `  width: ${String(width)},`,
    `  height: ${String(height)},`,
    "  rows: [",
    ...rows,
    "  ],",
    `  yaws: [${BAKE_YAWS.map(fixed).join(", ")}],`,
    "  apart: [",
    ...apart,
    "  ],",
    `  halfExtent: ${fixed(HALF_EXTENT)},`,
    "};",
    "",
  ].join("\n");
}

function main(): void {
  const { values } = parseArgs({
    options: { boxes: { type: "string" }, out: { type: "string" } },
  });
  const app = values.boxes === undefined && values.out === undefined;
  const boxes =
    values.boxes === undefined
      ? APP_BOXES
      : values.boxes.split(",").map((part) => Number.parseInt(part, 10));
  if (boxes.some((box) => !Number.isInteger(box) || box < 8 || box > 512)) {
    console.error(`칸 크기가 맞지 않다(8~512 정수): ${values.boxes ?? ""}`);
    process.exit(1);
  }
  const out = resolve(values.out ?? join(import.meta.dir, "../apps/desktop/src/views/effects"));
  mkdirSync(out, { recursive: true });
  let size = { width: 0, height: 0 };
  for (const theme of ["dark", "light"] as const) {
    const started = performance.now();
    const sheet = bakeSheet(boxes, theme);
    size = { width: sheet.width, height: sheet.height };
    const file = join(out, `crystal-${theme}.png`);
    writeFileSync(file, sheet.png);
    console.log(
      `${file}: ${String(sheet.width)}×${String(sheet.height)}, ${String(sheet.png.length)} B, ${String(Math.round(performance.now() - started))} ms`,
    );
  }
  if (app) {
    const file = join(out, "crystal-sheet.ts");
    writeFileSync(file, sheetModule(boxes, size.width, size.height));
    console.log(file);
  }
}

if (import.meta.main) main();
