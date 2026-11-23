// 오른쪽 well이 열릴 때 대화 열이 비키는 양(AGE-75 질문 1 가). well은 대화 열과 입력창을 덮지 않고, 대화 화면(`ScreenDef.wellBeside`)은
// well 자리만큼 오른쪽을 비운다. 무대가 좁아 비키면 대화 열이 최소 폭보다 좁아질 때만 well이 예전처럼 무대 위에 뜬다.

/** 대화 열(시안 46rem = 736px, 양쪽 안쪽 여백 12 포함)의 폭 */
export const CHAT_COLUMN_PX = 736;
/**
 * well을 옆에 둘 때 대화 열이 지킬 최소 폭. caustic `size.dialog-md`(480px)다. 대화 열 넘침 규칙(DP-180)이 480 폭까지 재어 둔 폭이라
 * 대화 줄, 표, 코드 상자, 입력창의 칩 줄이 이 폭에서 넘치지 않는다
 */
export const CHAT_COLUMN_MIN_PX = 480;
/** 무대 오른쪽 끝에서 막대 자리(`--stage-rail` 48)와 대화 열 사이 여유(`space-3` 12) */
const RAIL_SPACE_PX = 48 + 12;
/** 막대와 well 사이(`end-[calc(100%+var(--spacing)*1.5)]`) */
const WELL_GAP_PX = 6;

/**
 * 대화 열이 비킬 오른쪽 여백(px). 대화 열은 가운데 정렬이라 넓은 무대에서는 well에 닿지 않으므로 닿는 만큼만 비킨다(1920은 0, 1440은 일부).
 * 비키고 남은 폭이 {@link CHAT_COLUMN_MIN_PX}보다 좁으면 null이고, 그때 well은 무대 위에 뜬다.
 * `stageWidth`는 무대 폭, `wellWidth`는 열린 well의 폭이다
 */
export function wellBesideOf(stageWidth: number, wellWidth: number): number | null {
  const space = RAIL_SPACE_PX + wellWidth + WELL_GAP_PX;
  if (stageWidth - space < CHAT_COLUMN_MIN_PX) return null;
  // 가운데 정렬된 열의 오른쪽 끝이 well 왼쪽 여유선(무대 끝 − space)에 닿는 최소 여백. 가운데 정렬이라 여백의 절반만큼 왼쪽으로 간다
  return Math.min(space, Math.max(0, 2 * space + CHAT_COLUMN_PX - stageWidth));
}

/** 막대 자리 오른쪽 여백(`end-3` 12)과 막대(`--stage-rail` 48)와 막대-well 사이(6)를 뺀, well이 무대 왼쪽 끝에 닿는 폭의 덜어낼 값 */
const COVER_TAKEN_PX = 12 + 48 + WELL_GAP_PX;

/**
 * 넓게 편 well이 비키지 못하고(`wellBesideOf`가 null) 무대 위에 뜰 때의 폭(AGE-77 artView). 대화 열은 가운데 정렬이라 well이 열보다
 * 좁으면 열의 왼쪽 글이 well 가장자리 밖으로 삐져 보인다. 그래서 well이 무대 왼쪽 끝까지 닿아 대화 열을 깔끔히 덮는다
 */
export function wellCoverWidthOf(stageWidth: number): number {
  return Math.max(0, stageWidth - COVER_TAKEN_PX);
}
