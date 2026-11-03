// 바로 가기 `thread.next` / `thread.prev`(⌥⌘↓ / ⌥⌘↑, spec §4.8)의 순서 부분. 대화 목록(사이드바 순서, 최근 활동 먼저)에서
// 한 칸 옮긴 대화를 고른다. 고르는 일(`selectThread`)은 `app.tsx`가 목록 행과 같은 길로 한다.

/**
 * 선택된 대화에서 `delta`만큼 옮긴 대화. 끝에서 처음으로, 처음에서 끝으로 돈다.
 * 선택이 없거나 목록에 없으면 다음(1)은 첫 대화, 이전(-1)은 끝 대화다. 목록이 비면 `null`이다.
 */
export function stepThreadId<T>(ids: readonly T[], current: T | null, delta: 1 | -1): T | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return delta === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  return ids[(index + delta + ids.length) % ids.length] ?? null;
}
