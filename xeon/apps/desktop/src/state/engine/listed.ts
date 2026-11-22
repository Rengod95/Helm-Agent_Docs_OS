// src/state/engine/listed.ts
import type { ThreadSummary } from "@fresnel/contracts/wire";

/**
 * 목록(사이드바 수, 팔레트, 최근 작업 폴더, 새 대화 기본값)에서 뺄 대화인가: 엔진 내부 대화와 테스트 챗(`craftChat` 표지).
 * 엔진의 기본 `thread.list`도 테스트 챗을 빼므로, 거울이 `thread.started`로 알게 된 테스트 챗도 같은 기준으로 뺀다.
 * 테스트 챗 창은 `useThread(id)`로 자기 대화를 id로 읽으니 이 판정의 영향을 받지 않는다.
 */
export function hiddenFromLists(
  summary: Pick<ThreadSummary, "spawnedBy" | "craftChat"> | undefined,
): boolean {
  return summary?.spawnedBy?.kind === "internal" || summary?.craftChat !== undefined;
}
