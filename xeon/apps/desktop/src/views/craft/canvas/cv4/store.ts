// cv4 작업 상태: 보고 있는 프로필과 바뀐 모양, 접은 묶음, 관계 선을 다 보일지. 캔버스와 내부 화면을 오가도 남도록 모듈 하나에 둔다.
// 시안이라 저장하지 않는다(실제 저장은 `profile.put`의 일이다).
import { useSyncExternalStore } from "react";
import { initialScene } from "../shared-sample.ts";
import { attachCount } from "./sample-ext.ts";
import { attachProfile, profileFromSample, type CanvasProfile, type SceneId } from "./model.ts";

/** 처음 여는 장면: 공통 장면 키가 "attach"면 "한 자리에 여럿", 아니면 공통 표본의 고름을 따른다 */
function firstScene(): SceneId {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("fresnel.craft.canvasScene") === "attach"
  )
    return "attach";
  return initialScene();
}

export interface CanvasStore {
  readonly current: SceneId;
  readonly profiles: Readonly<Record<SceneId, CanvasProfile>>;
  readonly collapsed: ReadonlySet<string>;
  readonly allRelations: boolean;
}

function initial(): CanvasStore {
  return {
    current: firstScene(),
    profiles: {
      dev: profileFromSample("dev"),
      empty: profileFromSample("empty"),
      scale: profileFromSample("scale"),
      attach: attachProfile(attachCount()),
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
