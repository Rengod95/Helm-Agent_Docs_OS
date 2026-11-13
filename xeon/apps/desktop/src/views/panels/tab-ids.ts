// 오른쪽 막대의 "변경"·"컨텍스트" 탭 id(DP-198, DP-201). 상태 줄 칸이 이 탭을 열 때 `useShellActions().openEndTab(id)`에 넘긴다.

/** 변경 탭: 이 대화가 바꾼 파일과 턴별 되감기 */
export const CHANGES_TAB_ID = "changes";
/** 컨텍스트 탭: 채움, 구성, 요약 기록, 사용량, 실린 것 */
export const CONTEXT_TAB_ID = "context";
