// 플러그인 상세의 오른쪽 여백(AGE-77 S-09 바). 셸은 머리 뒤 본문에만 막대 자리(`--stage-rail`)와 12px을 준다(styles.css DP-68·DP-135,
// `#stage[data-rail] .shell-header:not([data-flush]) + *`). 상세는 머리를 감추므로 그 규칙이 상세의 칸에 닿지 않고, 두 단의 "복사"
// 단추가 떠 있는 막대 밑으로 들어갔다. 그래서 상세를 감싸는 스크롤 칸이 같은 자리와 여유를 직접 비운다. 쓰는 토큰은 셸 규칙과 같다.

/** 상세 스크롤 칸의 오른쪽 안쪽 여백: 막대 자리 `--stage-rail` 뒤에 `space-3`. 막대가 없으면 `--stage-rail`이 0이다 */
export const DETAIL_RAIL_INSET = "pe-[calc(var(--stage-rail,0px)+var(--cs-space-3))]";
