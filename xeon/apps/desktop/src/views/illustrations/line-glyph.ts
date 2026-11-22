// 직접 그린 아이콘의 바탕 선(m6R7 [결정: 2026-11-21 사용자 "alert 관련 아이콘들 stroke width가 너무 두껍다. 우리 empty state에 디자인했던
// vector graphic들 처럼 기반 스타일을 변경해", 2026-11-22 사용자 "더 가늘게", "다 1px기준으로", AGE-34]).
// 앱이 직접 그린 알림 그림(리뷰 화면의 `ToneGlyph`, 도구 줄의 실패·정책 거부 그림)과 종류 그림(Inject·Hook·Drive·도구·블록)은
// 이 한 벌로 선을 받는다: 면 채움 없음, 선 끝과 이음은 둥글게, 색은 부르는 쪽의 글 색(currentColor, 토큰 그대로).
// 굵기는 `illustrations.css`의 `--line-glyph-width` 하나(화면 1px)이고, 그림의 칸(16·14·12·10)과 상관없이 그 px로 그려진다(non-scaling-stroke).
// 가로·세로 획은 0.5 칸 배수 좌표에 둔다: 2배 밀도 화면에서 1px 선이 화소 두 줄에 꼭 맞아 번지지 않는다.

/** svg 뿌리에 펼친다. 선 굵기 속성(strokeWidth)은 주지 않는다: 속성이 CSS 변수를 덮기 때문이다 */
export const LINE_GLYPH = {
  className: "line-glyph",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type Point = readonly [number, number];

interface Corner {
  readonly at: Point;
  /** 꼭짓점으로 들어오는 변의 방향 */
  readonly from: Point;
  /** 꼭짓점에서 나가는 변의 방향 */
  readonly to: Point;
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * 막힘 팔각형(멈춤 표지)의 윤곽. `lo`~`hi`는 가로·세로 변의 좌표(0.5 칸 배수로 주면 또렷하다), `cut`은 모서리를 깎는 길이,
 * `round`는 꼭짓점마다 곡선으로 꺾기 시작하는 거리다(빈 상태 그림의 둥근 모서리 문법. 크게 주면 고리로 읽힌다)
 */
export function octagonPath(lo: number, hi: number, cut: number, round: number): string {
  const s = Math.SQRT1_2;
  const a = lo + cut;
  const b = hi - cut;
  const corners: readonly Corner[] = [
    { at: [b, lo], from: [1, 0], to: [s, s] },
    { at: [hi, a], from: [s, s], to: [0, 1] },
    { at: [hi, b], from: [0, 1], to: [-s, s] },
    { at: [b, hi], from: [-s, s], to: [-1, 0] },
    { at: [a, hi], from: [-1, 0], to: [-s, -s] },
    { at: [lo, b], from: [-s, -s], to: [0, -1] },
    { at: [lo, a], from: [0, -1], to: [s, -s] },
    { at: [a, lo], from: [s, -s], to: [1, 0] },
  ];
  const turns = corners.map(
    ({ at, from, to }) =>
      `L${num(at[0] - from[0] * round)} ${num(at[1] - from[1] * round)} Q${num(at[0])} ${num(at[1])} ${num(at[0] + to[0] * round)} ${num(at[1] + to[1] * round)}`,
  );
  return `M${num(a + round)} ${num(lo)} ${turns.join(" ")}Z`;
}
