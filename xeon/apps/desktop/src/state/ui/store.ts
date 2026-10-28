// src/state/ui/store.ts
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";

/**
 * 응답을 보낸 뒤 승인 카드가 보이는 실패 표시. 같은 "적용되지 않음"도 이유에 따라 사용자가 할 일이 달라 나눠 둔다:
 * failed(연결이나 host 오류, 다시 누른다), invalid(답이 맞지 않음, 선택을 고쳐 다시 보낸다),
 * closed(다른 곳에서 이미 해결됨, 곧 사라진다), unapplied(적용되지 않았다는 것만 알림, 이유 미상)
 */
export type ApprovalFailure = "failed" | "invalid" | "closed" | "unapplied";
export type ApprovalSend = "sending" | ApprovalFailure;

/** 화면 둘 중 지금 보이는 것. 설정은 대화 화면 위에 열리는 같은 창의 다른 화면이다 */
export type Screen = "chat" | "settings";

/** `thread.locked`(3002)의 대안 중 이 화면이 보이는 것. `delegate`는 서비스 공급원에서만 있어 보이지 않는다(L4.desktop.spec §5) */
export type LockedOption = "observe" | "fork";

/** 다른 프로세스(CLI 등)가 쓰기 소유를 쥔 thread. 대화 상자가 이 값을 그린다 */
export type LockedThread = {
  readonly threadId: ThreadId;
  /** 소유자 종류(예: `cli`, `desktop`). host가 준 짧은 문자열이다 */
  readonly ownerKind: string;
  readonly options: readonly LockedOption[];
};

export type UiState = {
  readonly selectedThreadId: ThreadId | null;
  /** 응답을 보냈지만 approval.resolved를 아직 받지 못한 승인. 낙관적 표시는 이 스토어에 두고 엔진 거울에는 두지 않는다 */
  readonly approvalSends: Readonly<Record<string, ApprovalSend>>;
  /** `answer_invalid` 같은 실패에 host가 붙인 한 줄 설명. 실패 표시가 있는 승인에만 있다 */
  readonly approvalDetails: Readonly<Record<string, string>>;
  readonly sidebarOpen: boolean;
  /** 연결을 열지 못한 이유(고정 코드). 엔진 사실이 아니라 이 화면의 시도 결과라 거울이 아닌 이곳에 둔다 */
  readonly connectError: string | null;
  readonly screen: Screen;
  /** `thread.locked`로 쓰기를 거절당한 thread. 대화 상자가 열려 있는 동안만 있다 */
  readonly locked: LockedThread | null;
  /** 관찰 모드로 연 thread. 입력창이 잠긴다 */
  readonly observing: Readonly<Record<string, true>>;
};

interface UiActions {
  selectThread(id: ThreadId | null): void;
  approvalSending(id: EventId): void;
  approvalFailed(id: EventId, kind?: ApprovalFailure, detail?: string): void;
  approvalSettled(id: EventId): void;
  /** 거울의 대기열에 더는 없는 승인의 표시를 지운다. 같은 객체를 돌려줄 수 있으면 상태를 바꾸지 않는다 */
  pruneApprovalSends(live: readonly string[]): void;
  toggleSidebar(): void;
  setConnectError(code: string | null): void;
  showScreen(screen: Screen): void;
  showLocked(locked: LockedThread): void;
  dismissLocked(): void;
  setObserving(id: ThreadId, observing: boolean): void;
}

const INITIAL_UI: UiState = {
  selectedThreadId: null,
  approvalSends: {},
  approvalDetails: {},
  sidebarOpen: true,
  connectError: null,
  screen: "chat",
  locked: null,
  observing: {},
};

export type UiStore = { readonly read: ReadonlyStore<UiState>; readonly actions: UiActions };

export function createUiStore(): UiStore {
  const api = createStore<UiState>()(() => INITIAL_UI);
  const setSend = (id: EventId, value: ApprovalSend | undefined, detail?: string): void =>
    api.setState((s) => {
      const { [id]: _old, ...rest } = s.approvalSends;
      const { [id]: _oldDetail, ...restDetails } = s.approvalDetails;
      return {
        approvalSends: value === undefined ? rest : { ...rest, [id]: value },
        approvalDetails: detail === undefined ? restDetails : { ...restDetails, [id]: detail },
      };
    });
  const actions: UiActions = {
    selectThread: (id) => api.setState({ selectedThreadId: id }),
    approvalSending: (id) => setSend(id, "sending"),
    approvalFailed: (id, kind = "failed", detail) => setSend(id, kind, detail),
    approvalSettled: (id) => setSend(id, undefined),
    pruneApprovalSends: (live) =>
      api.setState((s) => {
        const kept = Object.entries(s.approvalSends).filter(([id]) => live.includes(id));
        if (kept.length === Object.keys(s.approvalSends).length) return s;
        const keptIds = new Set(kept.map(([id]) => id));
        return {
          approvalSends: Object.fromEntries(kept),
          approvalDetails: Object.fromEntries(
            Object.entries(s.approvalDetails).filter(([id]) => keptIds.has(id)),
          ),
        };
      }),
    toggleSidebar: () => api.setState((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setConnectError: (code) => api.setState({ connectError: code }),
    showScreen: (screen) => api.setState({ screen }),
    showLocked: (locked) => api.setState({ locked }),
    dismissLocked: () => api.setState({ locked: null }),
    setObserving: (id, observing) =>
      api.setState((s) => {
        if ((s.observing[id] === true) === observing) return s;
        const { [id]: _old, ...rest } = s.observing;
        return { observing: observing ? { ...rest, [id]: true } : rest };
      }),
  };
  return { read: readonlyView(api), actions };
}
