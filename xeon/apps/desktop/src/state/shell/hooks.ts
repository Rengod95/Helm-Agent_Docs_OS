// src/state/shell/hooks.ts
import { Bug } from "@fresnel/contracts";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ShellModel } from "./model.ts";
import type { ShellActions, ShellStore } from "./store.ts";

export const ShellStoreContext: React.Context<ShellStore | null> = createContext<ShellStore | null>(
  null,
);

function useShellStore(): ShellStore {
  const store = useContext(ShellStoreContext);
  if (store === null) throw new Bug("ShellStoreContext provider is missing");
  return store;
}

/** 셸 상태 한 조각을 읽는다. 선택자가 같은 값을 돌려주면 다시 그리지 않는다 */
export function useShell<U>(selector: (state: ShellModel) => U): U {
  return useStore(useShellStore().read, selector);
}

export function useShellActions(): ShellActions {
  return useShellStore().actions;
}
