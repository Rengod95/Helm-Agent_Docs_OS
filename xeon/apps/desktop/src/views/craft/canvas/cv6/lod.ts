// cv6 판이 확대 단계마다 무엇을 보이는가. 순수 값만 둔다(노드 그리기와 시험이 같은 표를 본다).
// 판의 크기(316 × 289)는 배율과 무관하다(배치는 확대를 모른다). 글과 칸은 "100% 값"과 "화면 눈금 × 확대의 역수(`--cv6-inv`)" 가운데
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
