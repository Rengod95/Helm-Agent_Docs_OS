// cvH 작업 상태: 보는 프로필과 바뀐 모양, 접은 묶음, 관계 선 보기. 캔버스와 내부를 오가도 남도록 모듈 하나에 둔다.
// 시안이라 저장하지 않는다(실제 저장은 `profile.put`의 일이다).
import { useSyncExternalStore } from "react";
import { initialScene, SHARED_PROFILES, type SharedProfileId } from "../shared-sample.ts";
import { fromShared, installedGroups, type CanvasProfile } from "./model.ts";

export interface CanvasStore {
  readonly current: SharedProfileId;
  readonly profiles: Readonly<Record<SharedProfileId, CanvasProfile>>;
  readonly folded: ReadonlySet<string>;
  /** 관계 선(의존·대체·생성)을 늘 보인다. 끄면 고른 노드의 것만 보인다(핸드오프는 늘 보인다) */
  readonly relations: boolean;
}

const PROFILE_IDS: readonly SharedProfileId[] = ["dev", "scale", "empty"];

function initial(): CanvasStore {
  return {
    current: initialScene(),
    profiles: {
      dev: fromShared(SHARED_PROFILES.dev),
      scale: fromShared(SHARED_PROFILES.scale),
      empty: fromShared(SHARED_PROFILES.empty),
    },
    folded: new Set(),
    relations: false,
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

function update(change: (s: CanvasStore) => CanvasStore): void {
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

export function chooseProfile(id: string): void {
  const next = PROFILE_IDS.find((p) => p === id);
  if (next !== undefined) update((s) => ({ ...s, current: next }));
}

export function setProfile(profile: CanvasProfile): void {
  update((s) => ({ ...s, profiles: { ...s.profiles, [s.current]: profile } }));
}

export function toggleFold(group: string): void {
  update((s) => {
    const folded = new Set(s.folded);
    if (folded.has(group)) folded.delete(group);
    else folded.add(group);
    return { ...s, folded };
  });
}

export function unfold(group: string): void {
  if (!state.folded.has(group)) return;
  toggleFold(group);
}

export function toggleRelations(): void {
  update((s) => ({ ...s, relations: !s.relations }));
}

/** 표본의 설치된 플러그인 그룹 */
export const INSTALLED_GROUPS: CanvasProfile["groups"] = installedGroups(
  PROFILE_IDS.map((id) => fromShared(SHARED_PROFILES[id])),
);
