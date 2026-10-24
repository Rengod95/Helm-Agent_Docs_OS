// src/state/ui/store.ts
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";

export type ApprovalSend = "sending" | "failed";

export type UiState = {
  readonly selectedThreadId: ThreadId | null;
  /** 응답을 보냈지만 approval.resolved를 아직 받지 못한 승인. 낙관적 표시는 이 스토어에 두고 엔진 거울에는 두지 않는다 */
  readonly approvalSends: Readonly<Record<string, ApprovalSend>>;
  readonly sidebarOpen: boolean;
  /** 연결을 열지 못한 이유(고정 코드). 엔진 사실이 아니라 이 화면의 시도 결과라 거울이 아닌 이곳에 둔다 */
  readonly connectError: string | null;
};

interface UiActions {
  selectThread(id: ThreadId | null): void;
  approvalSending(id: EventId): void;
  approvalFailed(id: EventId): void;
  approvalSettled(id: EventId): void;
  /** 거울의 대기열에 더는 없는 승인의 표시를 지운다. 같은 객체를 돌려줄 수 있으면 상태를 바꾸지 않는다 */
  pruneApprovalSends(live: readonly string[]): void;
  toggleSidebar(): void;
  setConnectError(code: string | null): void;
}

const INITIAL_UI: UiState = {
  selectedThreadId: null,
  approvalSends: {},
  sidebarOpen: true,
  connectError: null,
};

export type UiStore = { readonly read: ReadonlyStore<UiState>; readonly actions: UiActions };

export function createUiStore(): UiStore {
  const api = createStore<UiState>()(() => INITIAL_UI);
  const setSend = (id: EventId, value: ApprovalSend | undefined): void =>
    api.setState((s) => {
      const { [id]: _old, ...rest } = s.approvalSends;
      return { approvalSends: value === undefined ? rest : { ...rest, [id]: value } };
    });
  const actions: UiActions = {
    selectThread: (id) => api.setState({ selectedThreadId: id }),
    approvalSending: (id) => setSend(id, "sending"),
    approvalFailed: (id) => setSend(id, "failed"),
    approvalSettled: (id) => setSend(id, undefined),
    pruneApprovalSends: (live) =>
      api.setState((s) => {
        const kept = Object.entries(s.approvalSends).filter(([id]) => live.includes(id));
        return kept.length === Object.keys(s.approvalSends).length
          ? s
          : { approvalSends: Object.fromEntries(kept) };
      }),
    toggleSidebar: () => api.setState((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setConnectError: (code) => api.setState({ connectError: code }),
  };
  return { read: readonlyView(api), actions };
}
