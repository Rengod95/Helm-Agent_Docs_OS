// 가상 목록이 보는 자리를 지키는 규칙(dzM2 시안 §10, L4 desktop-ux DP-120). 순수 함수라 화면 밖에서 시험한다(virtual-list.tsx가 쓴다).

/**
 * 잰 높이가 바뀐 줄 가운데 보이는 영역 위에 통째로 있는 줄의 변화량 합. 위로 굴린 채 이만큼 스크롤을 옮기면 보는 글이 그대로다.
 * 보이는 영역에 걸치거나 아래에 있는 줄은 세지 않는다(그 줄 아래 내용이 밀리는 것은 자연스럽다)
 */
export function anchorShiftOf(input: {
  /** 이번 프레임에 잰 높이(키 → px) */
  readonly batch: ReadonlyMap<string, number>;
  /** 직전에 그린 배치 */
  readonly keys: readonly string[];
  readonly offsets: readonly number[];
  readonly heights: ReadonlyMap<string, number>;
  readonly scrollTop: number;
  /** 목록 위 안쪽 여백 */
  readonly padTop: number;
  /** 재지 않은 줄의 추정 높이 */
  readonly estimate: number;
}): number {
  const indexOf = new Map<string, number>();
  input.keys.forEach((key, index) => {
    indexOf.set(key, index);
  });
  let shift = 0;
  for (const [key, height] of input.batch) {
    const index = indexOf.get(key);
    if (index === undefined) continue;
    const old = input.heights.get(key) ?? input.estimate;
    if (input.padTop + (input.offsets[index] ?? 0) + old <= input.scrollTop) shift += height - old;
  }
  return shift;
}

/**
 * 바닥에 붙은 채 줄 하나를 펼칠 때 붙음을 풀지. 마지막 줄이 아닌 줄을 펼치면 푼다: 따라 내려가면 누른 줄의 머리가 위로 밀려 나간다.
 * 마지막 줄을 펼치거나 접을 때는 그대로 따라간다
 */
export function releasesOnExpand(input: {
  readonly opening: boolean;
  readonly rowKey: string | null;
  readonly lastKey: string | undefined;
}): boolean {
  return input.opening && input.rowKey !== null && input.rowKey !== input.lastKey;
}

/** "안 본 줄" 수: 바닥에 있던 때 없던 줄 가운데 세는 줄(메시지)만 */
export function unseenOf<R extends { readonly key: string }>(
  rows: readonly R[],
  baseline: ReadonlySet<string>,
  counts: (row: R) => boolean,
): number {
  return rows.filter((row) => counts(row) && !baseline.has(row.key)).length;
}
