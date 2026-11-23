// 오른쪽 막대 탭 id(DP-192, DP-198, DP-201). 상태 줄 칸 같은 다른 부품이 탭을 열 때 `useShellActions().openEndTab(id)`에 넘긴다.

/** 받은 요청 탭: 승인 대기와 요청 */
export const INBOX_TAB_ID = "inbox";
/** 실행 중 탭: 도는 대화·하위 에이전트·기다림·방금 끝남 */
export const RUNNING_TAB_ID = "running";

/** 변경 탭: 이 대화가 바꾼 파일과 턴별 되감기 */
export const CHANGES_TAB_ID = "changes";
/** 컨텍스트 탭: 채움, 구성, 요약 기록, 사용량, 실린 것 */
export const CONTEXT_TAB_ID = "context";
/** 아티팩트 탭: 이 대화에서 모델이 만든 HTML, SVG, 그림, 마크다운의 판(artView) */
export const ARTIFACT_TAB_ID = "artifact";
