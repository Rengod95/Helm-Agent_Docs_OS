// cv6 판이 확대 단계마다 무엇을 보이는가. 순수 값만 둔다(노드 그리기와 시험이 같은 표를 본다).
// 판 높이(90)는 단계마다 같고(배치는 확대와 무관하다), 단계마다 글자를 키워 위아래 여백이 좌우 여백(10)과 눈으로 같아 보이게 채운다.
//   가까이(85% 이상, 100%가 기준): 타일 28, 이름 14, 종류 11, 하는 일 12.5 두 줄, 상태 칩.
//   중간(48~85%, 처음 열 때 60% 안팎): 타일 30, 이름 19, 하는 일 15 두 줄. 60%에서 이름 11.4px, 하는 일 9px로 읽힌다.
//   멀리(48% 아래): 타일 40과 이름 24(두 줄까지 접는다), 상태는 칩 하나만 크게.
// 붙는 자리 문구("도구 실행에 넣음"), 구성 요소 수("지침 6"), 최근 사용, 같은 자리 순서는 판에서 빼고 상세 패널에 둔다.
import type { Placed } from "./model.ts";

export type Lod = "far" | "mid" | "near";

/** 단계 경계(확대 배율). 이 값 이상이면 다음 단계다 */
const LOD_EDGE = { mid: 0.48, near: 0.85 } as const;

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
