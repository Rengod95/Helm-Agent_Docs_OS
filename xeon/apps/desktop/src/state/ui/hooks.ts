// src/state/ui/hooks.ts
import { Bug } from "@xeon/contracts";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ReadonlyStore } from "../shared/readonly-store.ts";
import type { ApprovalSend, UiState } from "./store.ts";

export const UiStoreContext: React.Context<ReadonlyStore<UiState> | null> =
  createContext<ReadonlyStore<UiState> | null>(null);

function useUiStore(): ReadonlyStore<UiState> {
  const store = useContext(UiStoreContext);
  if (store === null) throw new Bug("UiStoreContext provider is missing");
  return store;
}

/** 모듈 안에서만 쓴다. 화면은 아래 도메인 훅만 쓴다 */
function useUi<U>(selector: (state: UiState) => U): U {
  return useStore(useUiStore(), selector);
}

export const useSelectedThreadId = (): ThreadId | null => useUi((s) => s.selectedThreadId);
export const useApprovalSend = (id: EventId): ApprovalSend | undefined =>
  useUi((s) => s.approvalSends[id]);
export const useConnectError = (): string | null => useUi((s) => s.connectError);
export const useSidebarOpen = (): boolean => useUi((s) => s.sidebarOpen);
