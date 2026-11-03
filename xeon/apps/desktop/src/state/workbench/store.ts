// 크래프트 스토어: `@fresnel/client/workbench`의 순수 함수를 zustand 스토어 하나로 감싼다(README는 그 패키지에 있다).
import type { Contrib, KindFilter, Sel } from "@fresnel/client/workbench/canvas";
import {
  clearPending,
  clearPick,
  closeBuilder,
  closeDetail,
  detailsLoaded,
  healthLoaded,
  INITIAL_WORKBENCH,
  listFailed,
  listLoaded,
  listLoading,
  markPending,
  openDetail,
  ordersLoaded,
  pickGroup,
  pickPlugin,
  pickSel,
  requestBuilder,
  select,
  setKind,
  setQuery,
  setView,
  toggleContrib,
  type WorkbenchState,
  type WorkbenchView,
} from "@fresnel/client/workbench";
import type { ExtGetResult, ExtHealthEntry, ExtListEntry } from "@fresnel/contracts/wire";
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";

export interface WorkbenchActions {
  listLoading(): void;
  listLoaded(entries: readonly ExtListEntry[]): void;
  listFailed(): void;
  setView(view: WorkbenchView): void;
  pickPlugin(id: string): void;
  pickGroup(id: string): void;
  pickSel(sel: Sel): void;
  clearPick(): void;
  select(name: string | null): void;
  openDetail(id: string): void;
  closeDetail(): void;
  setQuery(query: string): void;
  setKind(kind: KindFilter): void;
  toggleContrib(c: Contrib): void;
  detailsLoaded(name: string, result: ExtGetResult): void;
  healthLoaded(entries: readonly ExtHealthEntry[]): void;
  ordersLoaded(order: Readonly<Record<string, readonly string[]>>): void;
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
    pickPlugin: (id) => apply((s) => pickPlugin(s, id)),
    pickGroup: (id) => apply((s) => pickGroup(s, id)),
    pickSel: (sel) => apply((s) => pickSel(s, sel)),
    clearPick: () => apply(clearPick),
    select: (name) => apply((s) => select(s, name)),
    openDetail: (id) => apply((s) => openDetail(s, id)),
    closeDetail: () => apply(closeDetail),
    setQuery: (query) => apply((s) => setQuery(s, query)),
    setKind: (kind) => apply((s) => setKind(s, kind)),
    toggleContrib: (c) => apply((s) => toggleContrib(s, c)),
    detailsLoaded: (name, result) => apply((s) => detailsLoaded(s, name, result)),
    healthLoaded: (entries) => apply((s) => healthLoaded(s, entries)),
    ordersLoaded: (order) => apply((s) => ordersLoaded(s, order)),
    markPending: (name, target) => apply((s) => markPending(s, name, target)),
    clearPending: (name) => apply((s) => clearPending(s, name)),
    requestBuilder: (hook) => apply((s) => requestBuilder(s, hook)),
    closeBuilder: () => apply(closeBuilder),
    snapshot: () => api.getState(),
  };
  return { read: readonlyView(api), actions };
}
