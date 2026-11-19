// cv3 작업 상태: 보고 있는 프로필과 바뀐 모양, 접은 묶음, 관계 선을 다 보일지. 캔버스와 내부 화면을 오가도 남도록 모듈 하나에 둔다.
// 시안이라 저장하지 않는다(실제 저장은 `profile.put`의 일이다).
import { useSyncExternalStore } from "react";
import { initialScene, type SharedProfileId } from "../shared-sample.ts";
import { profileFromSample, type CanvasProfile } from "./model.ts";

export interface CanvasStore {
  readonly current: SharedProfileId;
  readonly profiles: Readonly<Record<SharedProfileId, CanvasProfile>>;
  readonly collapsed: ReadonlySet<string>;
  readonly allRelations: boolean;
}

function initial(): CanvasStore {
  return {
    current: initialScene(),
    profiles: {
      dev: profileFromSample("dev"),
      empty: profileFromSample("empty"),
      scale: profileFromSample("scale"),
    },
    collapsed: new Set(),
    allRelations: false,
  };
}

let state: CanvasStore = initial();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function updateStore(change: (s: CanvasStore) => CanvasStore): void {
  state = change(state);
  for (const fn of listeners) fn();
}

export function useCanvasStore(): CanvasStore {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function currentProfile(s: CanvasStore): CanvasProfile {
  return s.profiles[s.current];
}

export function setProfile(profile: CanvasProfile): void {
  updateStore((s) => ({ ...s, profiles: { ...s.profiles, [s.current]: profile } }));
}

export function setCollapsed(id: string, collapsed: boolean): void {
  updateStore((s) => {
    const next = new Set(s.collapsed);
    if (collapsed) next.add(id);
    else next.delete(id);
    return { ...s, collapsed: next };
  });
}
