// 알림 그림의 바탕 선(m6R7 [결정: 2026-11-21 사용자 "alert 관련 아이콘들 stroke width가 너무 두껍다. 우리 empty state에 디자인했던
// vector graphic들 처럼 기반 스타일을 변경해", AGE-34]). 앱이 직접 그린 알림·경고·안내 그림(리뷰 화면의 `ToneGlyph`, 도구 칩의 실패 그림)은
// 이 한 벌로 선을 받는다: 면 채움 없음, 선 끝과 이음은 둥글게, 색은 부르는 쪽의 글 색(currentColor, 세기 토큰 그대로).
// 굵기는 `illustrations.css`의 `--line-glyph-width` 하나이고, 그림의 칸(16·12·14)과 상관없이 화면에 그 px로 그려진다(non-scaling-stroke).
// 빈 상태 그림의 머리카락 선(160 칸의 1.4를 128px로 = 1.12px)과 같은 굵기로 보이게 1.15px를 골랐다(1.0, 1.25와 실제 화면에서 견줌).

/** svg 뿌리에 펼친다. 선 굵기 속성(strokeWidth)은 주지 않는다: 속성이 CSS 변수를 덮기 때문이다 */
export const LINE_GLYPH = {
  className: "line-glyph",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
