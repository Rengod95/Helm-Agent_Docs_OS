// 크래프트 스토어: `@fresnel/client/workbench`의 순수 함수를 zustand 스토어 하나로 감싼다(README는 그 패키지에 있다).
import type { ExtListEntry } from "@fresnel/contracts/wire";
import {
  clearPending,
  closeBuilder,
  closeDetail,
  INITIAL_WORKBENCH,
  listFailed,
  listLoaded,
  listLoading,
  markPending,
  openDetail,
  openLayer,
  requestBuilder,
  select,
  setQuery,
  setView,
  toggleKind,
  type ComponentKind,
  type LayerKey,
  type WorkbenchState,
  type WorkbenchView,
} from "@fresnel/client/workbench";
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";

export interface WorkbenchActions {
  listLoading(): void;
  listLoaded(entries: readonly ExtListEntry[]): void;
  listFailed(): void;
  setView(view: WorkbenchView): void;
  select(name: string | null): void;
  openDetail(name: string): void;
  closeDetail(): void;
  openLayer(layer: LayerKey | null): void;
  setQuery(query: string): void;
  toggleKind(kind: ComponentKind): void;
  markPending(name: string, target: boolean): void;
  clearPending(name: string): void;
  requestBuilder(hook: string | null): void;
  closeBuilder(): void;
  snapshot(): WorkbenchState;
}

export interface WorkbenchStore {
  readonly read: ReadonlyStore<WorkbenchState>;
  readonly actions: WorkbenchActions;
}

/** `start`는 처음 상태를 바꾼다(시험). 서버 렌더는 처음 상태만 읽는다 */
export function createWorkbenchStore(
  start: (state: WorkbenchState) => WorkbenchState = (state) => state,
): WorkbenchStore {
  const api = createStore<WorkbenchState>()(() => start(INITIAL_WORKBENCH));
  const apply = (f: (s: WorkbenchState) => WorkbenchState): void => {
    const prev = api.getState();
    const next = f(prev);
    if (next !== prev) api.setState(next, true);
  };
  const actions: WorkbenchActions = {
    listLoading: () => apply(listLoading),
    listLoaded: (entries) => apply((s) => listLoaded(s, entries)),
    listFailed: () => apply(listFailed),
    setView: (view) => apply((s) => setView(s, view)),
    select: (name) => apply((s) => select(s, name)),
    openDetail: (name) => apply((s) => openDetail(s, name)),
    closeDetail: () => apply(closeDetail),
    openLayer: (layer) => apply((s) => openLayer(s, layer)),
    setQuery: (query) => apply((s) => setQuery(s, query)),
    toggleKind: (kind) => apply((s) => toggleKind(s, kind)),
    markPending: (name, target) => apply((s) => markPending(s, name, target)),
    clearPending: (name) => apply((s) => clearPending(s, name)),
    requestBuilder: (hook) => apply((s) => requestBuilder(s, hook)),
    closeBuilder: () => apply(closeBuilder),
    snapshot: () => api.getState(),
  };
  return { read: readonlyView(api), actions };
}
