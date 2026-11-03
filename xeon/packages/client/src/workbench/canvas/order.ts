// 한 훅 줄 안의 핸들러 순서 판단. 훅 사이 이동은 없고, 값은 Registration id 문자열뿐이다.
// 티어와 상관없이 자유롭게 옮긴다(guard 포함, 결정 15-2). 옮긴 뒤의 위험은 엔진 미리보기가 알린다.

/** 핸들러 칩 하나의 화면 자리. 끌기 중 놓을 곳을 찾을 때 쓴다 */
export interface ChipBox {
  readonly id: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * id를 toIndex 자리로 옮긴 새 순서. toIndex는 id를 뺀 목록에서의 자리이고, 범위를 벗어나면 가장자리다.
 * 없는 id면 같은 순서의 복사본을 돌려준다.
 */
export function moveHandler(order: readonly string[], id: string, toIndex: number): string[] {
  const rest = order.filter((x) => x !== id);
  if (rest.length === order.length) return [...order];
  const at = Math.min(rest.length, Math.max(0, toIndex));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Alt+←·→: 한 칸 앞이나 뒤로 옮긴다. 끝에서는 그대로다 */
export function nextOrderForKey(
  order: readonly string[],
  id: string,
  dir: "left" | "right",
): string[] {
  const at = order.indexOf(id);
  if (at < 0) return [...order];
  return moveHandler(order, id, dir === "left" ? at - 1 : at + 1);
}

/**
 * 끌어 놓을 자리. 포인터가 칩보다 위에 있거나 같은 줄의 왼쪽 절반에 있으면 그 칩 앞이다.
 * 끌고 있는 칩(dragged)은 셈하지 않는다.
 */
export function dropIndex(
  boxes: readonly ChipBox[],
  dragged: string,
  x: number,
  y: number,
): number {
  const rest = boxes.filter((b) => b.id !== dragged);
  const at = rest.findIndex((b) => y < b.top || (y <= b.bottom && x < (b.left + b.right) / 2));
  return at < 0 ? rest.length : at;
}

/**
 * 차단(first) 줄에서 새 순서 때문에 건너뛰어질 수 있는 핸들러. 앞선 핸들러가 이전 순서에는 없던 것이면 해당된다.
 * 엔진 미리보기가 오기 전에만 쓰는 로컬 대용이다. 다른 접기(tap, chain, collect)는 빈 목록이다.
 */
export function skippableAfterMove(
  before: readonly string[],
  after: readonly string[],
  fold: string,
): string[] {
  if (fold !== "first") return [];
  return after.filter((id, i) => {
    // 이전 순서에 없던 id는 앞선 것이 전부 새 것이다
    const at = before.indexOf(id);
    const was = new Set(at < 0 ? [] : before.slice(0, at));
    return after.slice(0, i).some((x) => !was.has(x));
  });
}
