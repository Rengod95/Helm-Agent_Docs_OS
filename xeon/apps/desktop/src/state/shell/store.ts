// 셸 스토어: `model.ts`의 순수 함수를 zustand 스토어 하나로 감싼다. 화면은 훅으로 읽고 `ShellActions`로 바꾼다.
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";
import {
  dismissFloating,
  initialShell,
  openEndTab,
  resize,
  setContextKind,
  setEndOpen,
  setPaletteOpen,
  setStartOpen,
  switchArea,
  toggleArea,
  updatePlace,
  type Area,
  type AreaPlace,
  type ShellModel,
  type WorkbenchContext,
} from "./model.ts";

export interface ShellActions {
  resize(width: number): void;
  switchArea(area: Area): void;
  toggleArea(): void;
  /** 지금 영역의 화면·스크롤·오른쪽 탭을 갱신한다 */
  updatePlace(patch: Partial<AreaPlace>): void;
  /** 오른쪽 탭을 열고 끝 영역을 편다. 영역을 주면 그 영역의 탭으로 기억한다 */
  openEndTab(tab: string, area?: Area): void;
  setContextKind(kind: WorkbenchContext["kind"], id?: string): void;
  setStartOpen(open: boolean): void;
  setEndOpen(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  /** Esc: 뜬 패널을 닫는다. 닫은 것이 있으면 true */
  dismissFloating(): boolean;
  /** 지금 상태(키 처리기처럼 렌더 밖에서 읽을 때) */
  snapshot(): ShellModel;
  /** 저장해 둔 값 등으로 상태를 통째로 바꾼다(시작할 때 한 번) */
  replace(next: ShellModel): void;
}

export interface ShellStore {
  readonly read: ReadonlyStore<ShellModel>;
  readonly actions: ShellActions;
}

/** `start`는 처음 상태를 바꾼다(시험과 복원). 처음 상태는 `getInitialState`로도 보인다 */
export function createShellStore(
  width: number,
  start: (model: ShellModel) => ShellModel = (model) => model,
): ShellStore {
  const api = createStore<ShellModel>()(() => start(initialShell(width)));
  const apply = (f: (s: ShellModel) => ShellModel): void => {
    const prev = api.getState();
    const next = f(prev);
    if (next !== prev) api.setState(next, true);
  };
  const actions: ShellActions = {
    resize: (w) => apply((s) => resize(s, w)),
    switchArea: (a) => apply((s) => switchArea(s, a)),
    toggleArea: () => apply(toggleArea),
    updatePlace: (patch) => apply((s) => updatePlace(s, patch)),
    openEndTab: (tab, area) => apply((s) => openEndTab(s, tab, area)),
    setContextKind: (kind, id) => apply((s) => setContextKind(s, kind, id)),
    setStartOpen: (open) => apply((s) => setStartOpen(s, open)),
    setEndOpen: (open) => apply((s) => setEndOpen(s, open)),
    setPaletteOpen: (open) => apply((s) => setPaletteOpen(s, open)),
    dismissFloating() {
      const prev = api.getState();
      const next = dismissFloating(prev);
      if (next === prev) return false;
      api.setState(next, true);
      return true;
    },
    snapshot: () => api.getState(),
    replace: (next) => api.setState(next, true),
  };
  return { read: readonlyView(api), actions };
}
