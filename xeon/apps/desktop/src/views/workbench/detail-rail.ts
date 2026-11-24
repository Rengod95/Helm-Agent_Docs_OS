// 플러그인 상세의 오른쪽 여백과 막대(AGE-77 S-09 바). 셸은 머리 뒤 본문에 막대 자리(`--stage-rail`)와 12px을 준다(styles.css DP-68·DP-135,
// `#stage[data-rail] .shell-header:not([data-flush]) + *`). 막대가 없으면 본문의 `px-8`(32)이 그 자리다.
// [바뀜: 2026-11-24, plugHead] 상세도 시스템 머리줄을 쓰게 되어 상세 칸이 따로 막대 자리를 비우지 않는다(셸 규칙이 준다).
// 구성 탭의 캔버스는 화면을 채우도록 그 좌우 여백까지 나가고(막대는 캔버스 위에 뜬다), 떠 있는 설명 판은 막대 밑에 들지 않게 막대 자리를 비운다.
// 쓰는 토큰은 셸 규칙과 같다(막대가 있을 때 막대 자리 + space-3, 없을 때 space-8. 메트릭 그림 열(`viz.css`)과 같은 max 꼴이다).

/** 구성 탭 캔버스의 바깥 여백: 상세 칸의 왼쪽 여백(32)과 오른쪽 여백(막대 자리 + space-3 또는 32)만큼 밖으로 나가 칸 끝까지 찬다 */
export const CANVAS_BLEED =
  "-ms-8 -me-[max(var(--cs-space-8),calc(var(--stage-rail,0px)+var(--cs-space-3)))]";

/** 캔버스 위 떠 있는 설명 판의 오른쪽 자리: 막대가 있으면 막대 자리 + space-3, 없으면 space-3 */
export const PANEL_END = "end-[calc(var(--stage-rail,0px)+var(--cs-space-3))]";
