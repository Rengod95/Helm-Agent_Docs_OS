/**
 * 사이드 패널 줄 크기 한 곳. 탐색 줄(대화·제안·예약·연결·플러그인 화면·설정)과 대화 줄이 같은 값을 쓴다.
 * dsF에서 h-control-sm(28)·ui-sm(12)·icon-sm으로 낮췄더니 너무 작아 한 단계 되돌린다:
 * 높이 h-control-md(32), 글자 ui-md(13.5), 아이콘 icon-md(16)(caustic navigation 줄은 ui-sm/ui-dense뿐이라 앱 쪽에서 덮는다)
 * [결정: 2026-11-08 사용자 dsM, 글자 1~2px↑ · 높이 균형 → 오케스트레이터 기본값 32px/13.5px/16px]
 */
export const SIDE_ROW =
  "h-control-md! text-ui-md! [&_[data-slot=list-navigation-icon]]:size-icon-md [&_[data-slot=list-navigation-status]]:size-icon-md";
