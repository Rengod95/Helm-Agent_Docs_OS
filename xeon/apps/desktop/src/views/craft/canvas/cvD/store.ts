// cvD 작업 상태: 보고 있는 프로필과 그 프로필의 바뀐 모양, 접은 묶음.
// 캔버스와 내부 화면을 오가도 남도록 모듈 하나에 둔다(시안이라 저장하지 않는다. 실제 저장은 `profile.put`의 일이다).
import { useSyncExternalStore } from "react";
import type { CanvasProfile } from "./model.ts";
import { SAMPLE_PROFILES } from "./sample.ts";

export interface CanvasStore {
  readonly current: string;
  readonly profiles: Readonly<Record<string, CanvasProfile>>;
  readonly folded: ReadonlySet<string>;
}

function initial(): CanvasStore {
  const profiles: Record<string, CanvasProfile> = {};
  for (const p of SAMPLE_PROFILES) {
    profiles[p.id] = { id: p.id, startDrive: p.startDrive, entries: p.entries, groups: p.groups };
  }
  return { current: "dev", profiles, folded: new Set() };
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
  return s.profiles[s.current] ?? { id: s.current, startDrive: null, entries: [], groups: [] };
}

export function setCurrentProfile(profile: CanvasProfile): void {
  updateStore((s) => ({ ...s, profiles: { ...s.profiles, [profile.id]: profile } }));
}

export function toggleFold(group: string): void {
  updateStore((s) => {
    const folded = new Set(s.folded);
    if (folded.has(group)) folded.delete(group);
    else folded.add(group);
    return { ...s, folded };
  });
}
