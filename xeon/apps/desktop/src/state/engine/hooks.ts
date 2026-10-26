// src/state/engine/hooks.ts
import { Bug } from "@xeon/contracts";
import type { EventId, ItemId, ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import type { ThreadSummary } from "@xeon/contracts/wire";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ReadonlyStore } from "../shared/readonly-store.ts";
import * as sel from "./selectors.ts";
import type { EngineState } from "../../transport/ipc.ts";
import type { EngineMirror, Link, PendingApproval, StreamingItem } from "./state.ts";

export const EngineStoreContext: React.Context<ReadonlyStore<EngineMirror> | null> =
  createContext<ReadonlyStore<EngineMirror> | null>(null);

function useEngineStore(): ReadonlyStore<EngineMirror> {
  const store = useContext(EngineStoreContext);
  if (store === null) throw new Bug("EngineStoreContext provider is missing");
  return store;
}

/** 모듈 안에서만 쓴다. 화면은 아래 도메인 훅만 쓴다 */
function useEngine<U>(selector: (state: EngineMirror) => U): U {
  return useStore(useEngineStore(), selector);
}

export const useThreadIds = (): readonly ThreadId[] => useEngine(sel.selectThreadIds);
export const useThread = (id: ThreadId): ThreadSummary | undefined =>
  useEngine((s) => sel.selectThread(s, id));
export const useRecentWorkspaces = (limit: number): readonly string[] =>
  useEngine(useShallow((s: EngineMirror) => sel.selectRecentWorkspaces(s, limit)));
export const useTranscriptItemIds = (): readonly ItemId[] => useEngine(sel.selectTranscriptItemIds);
export const useItem = (id: ItemId): ItemRecord | undefined =>
  useEngine((s) => sel.selectItem(s, id));
export const useStreamingIds = (): readonly ItemId[] => useEngine(sel.selectStreamingIds);
export const useStreamingItem = (id: ItemId): StreamingItem | undefined =>
  useEngine((s) => sel.selectStreamingItem(s, id));
export const usePartText = (id: ItemId, contentIndex: number): string =>
  useEngine((s) => sel.selectPartText(s, id, contentIndex));
export const useApprovalIds = (): readonly EventId[] => useEngine(sel.selectApprovalIds);
export const useApproval = (id: EventId): PendingApproval | undefined =>
  useEngine((s) => sel.selectApproval(s, id));
export const useRunningCount = (): number => useEngine(sel.selectRunningCount);
export const useLinkBanner = (): { readonly phase: Link["phase"]; readonly attempt: number } =>
  useEngine(useShallow(sel.selectLinkBanner));
export const useEngineState = (): EngineState | null => useEngine(sel.selectEngine);
export const useLinkPhase = (): Link["phase"] => useEngine(sel.selectLinkPhase);
export const useThreadsStatus = (): EngineMirror["threads"]["status"] =>
  useEngine(sel.selectThreadsStatus);
export const useTranscriptStatus = (): "none" | "loading" | "ready" | "error" =>
  useEngine(sel.selectTranscriptStatus);
export const useOpenThreadId = (): ThreadId | null => useEngine(sel.selectOpenThreadId);
export const useUnlistedApprovals = (id: ThreadId): number =>
  useEngine((s) => sel.selectUnlistedApprovals(s, id));
export const useThreadRunning = (id: ThreadId): boolean =>
  useEngine((s) => sel.selectThreadRunning(s, id));
export const useTurnFailure = (id: ThreadId | null): string | null =>
  useEngine((s) => sel.selectTurnFailure(s, id));
export const useApprovalCount = (): number => useEngine(sel.selectApprovalCount);
