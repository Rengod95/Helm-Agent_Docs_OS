import { moveInOrder } from "@fresnel/client";

// 목록 순서를 키로 바꾸는 순수 함수(P-11, P-12 공용). 행에 초점이 있을 때 ↑·↓(Alt와 함께든 아니든)는 그 행을 한 칸 옮긴다.
// 끝에서는 움직이지 않는다. 끌기는 caustic `List reorderable`이 맡는다.

/** 한 칸 옮기기. `from`과 `to`는 옮기기 전과 뒤의 자리다 */
export interface OrderMove {
  readonly from: number;
  readonly to: number;
}

/** 행 자리 `index`(0부터)의 키 입력을 한 칸 옮기기로 바꾼다. 움직일 수 없으면 `null`이다 */
export function keyboardMoveOf(key: string, index: number, count: number): OrderMove | null {
  if (index < 0 || index >= count) return null;
  const to = key === "ArrowUp" ? index - 1 : key === "ArrowDown" ? index + 1 : null;
  if (to === null || to < 0 || to >= count) return null;
  return { from: index, to };
}

/** 옮긴 뒤의 전체 순서. 범위 밖이면 바꾸지 않은 복사본이다(`moveInOrder`) */
export function movedOrderOf(ids: readonly string[], move: OrderMove): readonly string[] {
  return moveInOrder(ids, move.from, move.to);
}
