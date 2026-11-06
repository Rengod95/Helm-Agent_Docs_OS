// src/state/workbench/hooks.ts
import { Bug } from "@fresnel/contracts";
import type { WorkbenchState } from "@fresnel/client/workbench";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { CraftScope, WorkbenchActions, WorkbenchStore } from "./store.ts";

export const WorkbenchStoreContext: React.Context<WorkbenchStore | null> =
  createContext<WorkbenchStore | null>(null);

function useWorkbenchStore(): WorkbenchStore {
  const store = useContext(WorkbenchStoreContext);
  if (store === null) throw new Bug("WorkbenchStoreContext provider is missing");
  return store;
}

/** 크래프트 상태 한 조각을 읽는다. 선택자 결과를 얕게 비교해, 새 객체나 배열을 돌려줘도 내용이 같으면 다시 그리지 않는다(React 185번 오류, 무한 반복 방지) */
export function useWorkbench<U>(selector: (state: WorkbenchState) => U): U {
  return useStore(useWorkbenchStore().read, useShallow(selector));
}

export function useWorkbenchActions(): WorkbenchActions {
  return useWorkbenchStore().actions;
}

/** 크래프트가 읽는 데이터 범위. 지금은 전역뿐이다 */
export function useWorkbenchScope(): CraftScope {
  return useWorkbenchStore().scope;
}
