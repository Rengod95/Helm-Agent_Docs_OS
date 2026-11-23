import { useSyncExternalStore } from "react";

// 아티팩트 판이 지금 보는 것(artView, AGE-77). 대화의 카드, 변경 탭, 판 머리의 고르기가 같은 값을 쓰도록 모듈 하나에 둔다.
// 대화마다 따로 기억하지 않는다: 다른 대화의 키는 그 대화에 없으므로 판이 가장 최근 아티팩트로 돌아간다.

export interface ArtifactPick {
  /** 아티팩트 키(`file:<경로>` 또는 `art:<id>`, artifact-model.ts) */
  readonly key: string;
  /** 고른 판 번호(1부터). null이면 최신 판을 따라간다(턴이 돌며 새 판이 생기면 그 판으로 바뀐다) */
  readonly version: number | null;
}

let pick: ArtifactPick | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 판이 보는 아티팩트와 판 번호. 고른 적이 없으면 null이다 */
export function useArtifactPick(): ArtifactPick | null {
  return useSyncExternalStore(
    subscribe,
    () => pick,
    () => pick,
  );
}

/** 볼 아티팩트를 고른다. 판 번호가 null이면 최신 판을 따라간다 */
export function pickArtifact(next: ArtifactPick): void {
  if (pick !== null && pick.key === next.key && pick.version === next.version) return;
  pick = next;
  for (const listener of listeners) listener();
}
