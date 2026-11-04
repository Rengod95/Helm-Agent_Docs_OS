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

/**
 * 크래프트 화면이 읽고 쓰는 데이터 범위. 지금은 전역만 있다. 프로젝트·대화 범위는 변형을 더한다(판별 유니온이라
 * 이 값을 가르는 `switch`가 모두 컴파일 오류로 알려 준다). 화면에서 고르지 않는다.
 */
export type CraftScope = { readonly kind: "global" };

/** 전역 범위: 범위가 없던 때와 같은 데이터를 읽고 쓴다 */
export const GLOBAL_SCOPE: CraftScope = { kind: "global" };

export interface WorkbenchStore {
  readonly read: ReadonlyStore<WorkbenchState>;
  readonly actions: WorkbenchActions;
  /** 데이터 범위. 지금은 `GLOBAL_SCOPE`로 고정이다. 호출 인자로 옮기는 자리는 `views/craft/craft-scope.ts`다 */
  readonly scope: CraftScope;
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
  return { read: readonlyView(api), actions, scope: GLOBAL_SCOPE };
}
