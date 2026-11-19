// cv3 판이 확대 단계마다 무엇을 보이는가. 순수 값만 둔다(노드 그리기와 시험이 같은 표를 본다).
// 판 높이는 단계마다 같고(배치는 확대와 무관하다), 단계마다 글자를 키워 빈 위아래 여백이 남지 않게 채운다.
//   가까이(85% 이상): 타일, 이름, 종류 이름, 하는 일 두 줄, 상태.
//   중간(48~85%): 타일, 이름(크게), 하는 일 두 줄(크게), 상태. 맞춤 보기(50~60%)에서 이름이 10~13px, 하는 일이 8~10px로 읽히는 크기다.
//   멀리(48% 아래): 타일과 이름(두 줄까지 접는다), 상태는 짧은 말로.
// 붙는 자리 문구("도구 실행에 넣음"), 구성 요소 수("지침 6"), 최근 사용, 같은 자리 순서는 판에서 빼고 상세 패널에 둔다.
import type { Placed } from "./model.ts";

export type Lod = "far" | "mid" | "near";

/** 단계 경계(확대 배율). 이 값 이상이면 다음 단계다 */
export const LOD_EDGE = { mid: 0.48, near: 0.85 } as const;

export function lodOf(zoom: number): Lod {
  if (zoom < LOD_EDGE.mid) return "far";
  if (zoom < LOD_EDGE.near) return "mid";
  return "near";
}

export type PlateField = "tile" | "name" | "kind" | "purpose" | "status";

/** 단계마다 판에 보이는 칸 */
export const PLATE_FIELDS: Readonly<Record<Lod, readonly PlateField[]>> = {
  far: ["tile", "name", "status"],
  mid: ["tile", "name", "purpose", "status"],
  near: ["tile", "name", "kind", "purpose", "status"],
};

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
