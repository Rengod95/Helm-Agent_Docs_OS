// 지도(Orbit) 이름표 솎기. 점 이름표는 글자 배율(--ls)이 1 아래로 줄지 않아, 지도를 줄이면 점 사이보다 이름표가 커져 겹친다.
// 화면 px에서 이름표 사각형을 어림해 우선순위 순으로 놓고, 앞서 놓은 이름표나 다른 점, 층·그룹 이름표를 덮는 것은 숨긴다.
// 숨긴 점도 점과 가리킴(hover)·키보드로 이름을 알 수 있다(점의 aria-label과 가리키면 나오는 이름표).
// 시안(wb-v5)은 각도 표를 손으로 골라 겹침을 피한다. 앱의 점은 데이터가 정하므로 같은 결과를 계산으로 얻는다.

/** 점 이름표가 점 중심에서 떨어진 간격(px, 글자 배율 전) */
const GAP = 19;
/** 이름표 높이(px, 글자 배율 전)와 좌우 안쪽 여백 합 */
const CHIP_H = 28;
const CHIP_PAD = 24;
/** 점 표식 반지름(px, 글자 배율 전). 이름표가 다른 점을 덮지 않게 한다 */
const DOT_R = 15;
/** 이름표 사이 최소 틈(px) */
const MARGIN = 3;
/** 글자 하나의 어림 폭(px, 13px 글자 기준): 한글·CJK는 넓고 영문은 좁다 */
const WIDE_PX = 13;
const NARROW_PX = 7.2;

export interface ChipCandidate {
  readonly id: string;
  /** 세계 좌표 */
  readonly x: number;
  readonly y: number;
  readonly name: string;
  /** 점이 가운데보다 오른쪽이면 이름표는 오른쪽에 앉는다 */
  readonly right: boolean;
  /** 클수록 먼저 놓는다 */
  readonly priority: number;
  /** 선택·강조라서 겹쳐도 늘 보인다 */
  readonly forced: boolean;
}

/** 이름표가 아닌 가림 대상(층·그룹·중심 이름표): 세계 좌표 중심, 화면 px 크기 */
export interface ChipObstacle {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Box {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

/** 글자 어림 폭 + 안쪽 여백(px, 글자 배율 전) */
export function chipWidth(name: string): number {
  let w = CHIP_PAD;
  for (const ch of name) w += (ch.codePointAt(0) ?? 0) >= 0x1100 ? WIDE_PX : NARROW_PX;
  return Math.ceil(w);
}

const hit = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** 사각형과 원이 겹치는가 */
function hitsCircle(box: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.min(Math.max(cx, box.l), box.r);
  const ny = Math.min(Math.max(cy, box.t), box.b);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

/**
 * 보일 이름표의 id. k는 지도 배율, ls는 글자 배율(둘 다 화면에서 읽은 값).
 * forced는 늘 보이고 나머지는 priority 내림차순(같으면 입력 순서)으로 놓되 겹치면 뺀다.
 */
export function visibleChips(
  items: readonly ChipCandidate[],
  obstacles: readonly ChipObstacle[],
  k: number,
  ls: number,
): ReadonlySet<string> {
  const boxOf = (c: ChipCandidate): Box => {
    const cx = c.x * k;
    const cy = c.y * k;
    const w = chipWidth(c.name) * ls;
    const near = GAP * ls;
    const l = c.right ? cx + near : cx - near - w;
    return { l, t: cy - (CHIP_H * ls) / 2, r: l + w, b: cy + (CHIP_H * ls) / 2 };
  };
  const fixed: Box[] = obstacles.map((o) => ({
    l: o.x * k - (o.w * ls) / 2,
    r: o.x * k + (o.w * ls) / 2,
    t: o.y * k - (o.h * ls) / 2,
    b: o.y * k + (o.h * ls) / 2,
  }));
  const order = items
    .map((c, i) => ({ c, i }))
    .toSorted(
      (a, b) => Number(b.c.forced) - Number(a.c.forced) || b.c.priority - a.c.priority || a.i - b.i,
    );
  const placed: Box[] = [];
  const shown = new Set<string>();
  for (const { c } of order) {
    const box = boxOf(c);
    const padded: Box = {
      l: box.l - MARGIN,
      r: box.r + MARGIN,
      t: box.t - MARGIN,
      b: box.b + MARGIN,
    };
    const blocked =
      !c.forced &&
      (placed.some((p) => hit(padded, p)) ||
        fixed.some((p) => hit(padded, p)) ||
        items.some((o) => o.id !== c.id && hitsCircle(padded, o.x * k, o.y * k, DOT_R * ls)));
    if (blocked) continue;
    placed.push(box);
    shown.add(c.id);
  }
  return shown;
}
