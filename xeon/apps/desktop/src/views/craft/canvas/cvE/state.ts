// cvE 화면 상태 한 벌. 프로필 캔버스와 플러그인 내부를 오가도 고친 프로필·접은 묶음·고른 노드가 남도록 모듈에 둔다.
// 표본만 고친다(저장하지 않는다). 실제 프로필은 읽기만 한다(`real.ts`).
import { useSyncExternalStore } from "react";
import type { ProfileModel } from "./model.ts";
import { EMPTY_PROFILE, SAMPLE_PROFILE } from "./sample.ts";

export interface CanvasState {
  /** 고른 프로필 id: 표본 둘("dev", "empty")이나 실제 프로필 id */
  readonly profileId: string;
  /** 표본 프로필의 지금 값(고친 결과) */
  readonly samples: Readonly<Record<string, ProfileModel>>;
  readonly closed: ReadonlySet<string>;
  readonly selected: string | null;
}

const INITIAL: CanvasState = {
  profileId: "dev",
  samples: { dev: SAMPLE_PROFILE, empty: EMPTY_PROFILE },
  closed: new Set(),
  selected: null,
};

let current: CanvasState = INITIAL;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function updateCanvas(fn: (s: CanvasState) => CanvasState): void {
  current = fn(current);
  for (const l of listeners) l();
}

export function useCanvasState(): CanvasState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => INITIAL,
  );
}

export function putSample(profile: ProfileModel): void {
  updateCanvas((s) => ({ ...s, samples: { ...s.samples, [profile.id]: profile } }));
}

export function toggleGroup(id: string): void {
  updateCanvas((s) => {
    const closed = new Set(s.closed);
    if (closed.has(id)) closed.delete(id);
    else closed.add(id);
    return { ...s, closed, selected: s.selected === id ? null : s.selected };
  });
}

export function select(id: string | null): void {
  updateCanvas((s) => (s.selected === id ? s : { ...s, selected: id }));
}

export function pickProfile(id: string): void {
  updateCanvas((s) => ({ ...s, profileId: id, selected: null }));
}
