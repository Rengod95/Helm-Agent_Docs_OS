// src/state/workbench/hooks.ts
import { Bug } from "@fresnel/contracts";
import type { WorkbenchState } from "@fresnel/client/workbench";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { CraftScope, WorkbenchActions, WorkbenchStore } from "./store.ts";

export const WorkbenchStoreContext: React.Context<WorkbenchStore | null> =
  createContext<WorkbenchStore | null>(null);

function useWorkbenchStore(): WorkbenchStore {
  const store = useContext(WorkbenchStoreContext);
  if (store === null) throw new Bug("WorkbenchStoreContext provider is missing");
  return store;
}

/** 크래프트 상태 한 조각을 읽는다. 선택자가 같은 값을 돌려주면 다시 그리지 않는다 */
export function useWorkbench<U>(selector: (state: WorkbenchState) => U): U {
  return useStore(useWorkbenchStore().read, selector);
}

export function useWorkbenchActions(): WorkbenchActions {
  return useWorkbenchStore().actions;
}

/** 크래프트가 읽는 데이터 범위. 지금은 전역뿐이다 */
export function useWorkbenchScope(): CraftScope {
  return useWorkbenchStore().scope;
}
