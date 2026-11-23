// cv6 판이 확대 단계마다 무엇을 보이는가. 순수 값만 둔다(노드 그리기와 시험이 같은 표를 본다).
// 판의 너비(316)는 배율과 무관하다. 높이는 배치 눈금 칸마다 그 단계의 내용만큼이다(아래 "배치 눈금"). 글과 칸은 "100% 값"과 "화면 눈금 × 확대의 역수(`--cv6-inv`)" 가운데
// 큰 것이다. 그래서 85%쯤 위에서는 참고 그림의 카드가 그대로 커지고, 그 아래에서는 화면 크기가 눈금에 머문다(이름 12, 탭 글 11, 안 여백 8).
// 단계 사이에서 글이 튀지 않는다 [결정: 2026-11-23 사용자, AGE-31 "저배율일때 텍스트 사이즈가 너무 크고, 텍스트 배열이나 레이아웃도 어색해"].
//   가까이(85% 이상): 참고 그림의 카드 그대로. 머리(그림 + 이름 + 상태 + 세로 점 셋) → 목적 두 줄 → 안쪽 면(꼬리표 + 설명) → 알약 → 사실 줄.
//   중간(48~85%): 머리(그림 + 이름 한 줄) → 목적 세 줄까지 → 알약. 안쪽 면과 사실 줄은 뺀다.
//   멀리(48% 아래): 탭(종류 그림)과 머리(그림 + 이름 한 줄 말줄임)만, 카드 세로 가운데에.
import type { Placed } from "./model.ts";

export type Lod = "far" | "mid" | "near";

/** 단계 경계(확대 배율). 이 값 이상이면 다음 단계다 */
const LOD_EDGE = { mid: 0.48, near: 0.85 } as const;

/** 확대의 역수(소수 셋째 자리). 0 이하의 값은 1로 본다 */
export function zoomInverse(zoom: number): number {
  if (!(zoom > 0)) return 1;
  return Math.round((1 / zoom) * 1000) / 1000;
}

export function lodOf(zoom: number): Lod {
  if (zoom < LOD_EDGE.mid) return "far";
  if (zoom < LOD_EDGE.near) return "mid";
  return "near";
}

// ── 배치 눈금(cvZoom, AGE-31) ──────────────────────────────────────
// 판의 높이는 그 배율에 보이는 내용만큼이다 [결정: 2026-11-23 사용자, AGE-31 "30%일 때 노드의 height가 텍스트에 맞춰서 줄어들었다가
// 확대되면 늘어났다가"]. 낮은 배율의 글과 여백은 화면 크기에 머물러(위의 식) 같은 내용도 캔버스 높이가 배율마다 다르므로, 배율을 눈금
// 여덟 칸(멀리 넷, 중간 셋, 가까이 하나)으로 나누고 칸마다 한 번 판 높이와 판 사이를 다시 잡는다. 칸 안에서는 배치가 그대로라
// 확대하는 동안 판이 움직이지 않는다. 칸의 높이는 그 칸에서 가장 낮은 배율(아래 경계에서 STEP_SLACK만큼 더 내려간 곳)의 내용이라 글이
// 넘치지 않고, 칸 안에서 남는 높이는 칸의 폭(배율로 1.25배쯤)을 넘지 않는다.

/** 배치 눈금 칸의 아래 경계(배율). 넷째(0.48)와 일곱째(0.85)가 단계 경계다 */
const STEP_EDGES = [0.2, 0.24, 0.29, 0.37, 0.48, 0.6, 0.72, 0.85] as const;
/**
 * 내려갈 때만 늦게 바뀐다: 칸의 아래 경계보다 4% 더 내려가야 아래 칸으로 간다(올라갈 때는 경계에서 바로).
 * 경계에서 줌을 조금씩 오가도 배치가 떨리지 않는다
 */
const STEP_SLACK = 0.04;
/** 판 사이를 화면에서 고르게: 세로(위 판의 아래 변에서 아래 판의 탭 끝까지) 32(space-8), 가로 24(space-6). 100%의 값과 같다 */
const SCREEN_STACK_GAP = 32;
const SCREEN_COL_GAP = 24;

/** 배율이 드는 눈금 칸(0~7). `prev`가 있으면 내려갈 때만 STEP_SLACK만큼 늦게 바뀐다 */
export function stepOf(zoom: number, prev: number | null): number {
  if (!(zoom > 0)) return STEP_EDGES.length - 1;
  let raw = 0;
  STEP_EDGES.forEach((edge, i) => {
    if (zoom >= edge) raw = i;
  });
  if (prev === null || raw >= prev) return raw;
  const edge = STEP_EDGES[prev];
  return edge !== undefined && zoom >= edge / (1 + STEP_SLACK) ? prev : raw;
}

/** 한 칸의 판 높이와 판 사이. 캔버스 단위(px at 100%) */
export interface StepMetrics {
  readonly lod: Lod;
  /** 목적과 설명이 다 있는 판(묶음 안의 판은 늘 이 높이) */
  readonly full: number;
  /** 목적이 없을 때 빠지는 높이(중간: 목적 한 줄과 그 위 여백) */
  readonly noPurpose: number;
  /** 설명이 없을 때 빠지는 높이(중간: 안쪽 면의 셋째 줄까지 대신 "설명이 없어요" 한 줄) */
  readonly noDescription: number;
  /** 목적도 설명도 없는 판(적은 판) */
  readonly lean: number;
  /** 더미 안 판 사이(탭이 솟는 자리 포함) */
  readonly stackGap: number;
  /** 옆 더미 사이, 받침판 안 구성원 사이 */
  readonly colGap: number;
}

/** 가까이: 참고 그림의 카드(`layout.ts`의 PLATE_H 289, 적은 판 196). 85% 위에서는 글과 여백이 100% 값이라 높이가 늘 같다 */
export const NEAR_METRICS: StepMetrics = {
  lod: "near",
  full: 289,
  noPurpose: 0,
  noDescription: 0,
  lean: 196,
  stackGap: 20 + SCREEN_STACK_GAP,
  colGap: SCREEN_COL_GAP,
};

/** 칸의 높이를 재는 배율: 그 칸에서 가장 낮은 배율 */
function lowestZoomOf(step: number): number {
  const edge = STEP_EDGES[step] ?? 1;
  return step === 0 ? edge : edge / (1 + STEP_SLACK);
}

/**
 * 한 칸의 판 높이. `cv6.css`의 식("100%의 값"과 "화면 눈금 × 확대의 역수" 가운데 큰 것)을 그 칸의 가장 낮은 배율에서 잰 값을 올림한다.
 *   멀리: 안 여백 + 머리 한 줄 + 안 여백.
 *   중간: 안 여백 + 머리 + (목적 위 여백 + 목적 한 줄) + 안쪽 면 위 여백 + 안쪽 면(여백 + 꼬리표 + 사이 + 글 세 줄 + 여백) + 안 여백.
 */
export function metricsOf(step: number): StepMetrics {
  const lod = lodOf(STEP_EDGES[step] ?? 1);
  if (lod === "near") return NEAR_METRICS;
  const z = 1 / lowestZoomOf(step);
  const at = (full: number, screen: number): number => Math.max(full, screen * z);
  const pad = at(12, 8);
  const line = at(20, 16);
  const tabRise = Math.min(36, at(20, 17));
  const gaps = {
    stackGap: Math.ceil(tabRise + SCREEN_STACK_GAP * z),
    colGap: Math.ceil(SCREEN_COL_GAP * z),
  };
  if (lod === "far") {
    const h = Math.ceil(pad * 2 + line);
    return { lod, full: h, noPurpose: 0, noDescription: 0, lean: h, ...gaps };
  }
  const purpose = at(12, 8) + line;
  const wellPad = at(8, 6);
  const wellTop = at(5, 4) + at(18, 14);
  const full = Math.ceil(
    pad + line + purpose + at(10, 8) + wellPad + wellTop + line * 3 + wellPad + pad,
  );
  const noPurpose = Math.ceil(purpose);
  const noDescription = Math.floor(line * 2);
  return { lod, full, noPurpose, noDescription, lean: full - noPurpose - noDescription, ...gaps };
}

/** 두 칸 사이를 옮겨 가는 동안의 값(t: 0이면 a, 1이면 b). 단계(무엇을 보이나)는 처음부터 b다 */
export function mixMetrics(a: StepMetrics, b: StepMetrics, t: number): StepMetrics {
  const k = Math.min(1, Math.max(0, t));
  const at = (x: number, y: number): number => x + (y - x) * k;
  return {
    lod: b.lod,
    full: at(a.full, b.full),
    noPurpose: at(a.noPurpose, b.noPurpose),
    noDescription: at(a.noDescription, b.noDescription),
    lean: at(a.lean, b.lean),
    stackGap: at(a.stackGap, b.stackGap),
    colGap: at(a.colGap, b.colGap),
  };
}

/** 판의 상태 표시. 경고(드래프트·리뷰 대기·오류)가 앞에 선다 */
export type PlateMark = "error" | "draft" | "pending" | "start" | "base";

export function plateMarks(placed: Placed): readonly PlateMark[] {
  const meta = placed.plugin.meta;
  const out: PlateMark[] = [];
  if (meta.health === "error" || meta.health === "integrity") out.push("error");
  if (meta.review.state === "draft") out.push("draft");
  else if (meta.pending !== null) out.push("pending");
  if (placed.start) out.push("start");
  if (placed.source.type === "base") out.push("base");
  return out;
}
