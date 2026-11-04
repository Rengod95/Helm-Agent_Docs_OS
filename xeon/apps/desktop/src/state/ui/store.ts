// src/state/ui/store.ts
import type { EventId, JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import { createStore } from "zustand/vanilla";
import { readonlyView, type ReadonlyStore } from "../shared/readonly-store.ts";

/**
 * 응답을 보낸 뒤 승인 카드가 보이는 실패 표시. 같은 "적용되지 않음"도 이유에 따라 사용자가 할 일이 달라 나눠 둔다:
 * failed(연결이나 host 오류, 다시 누른다), invalid(답이 맞지 않음, 선택을 고쳐 다시 보낸다),
 * closed(다른 곳에서 이미 해결됨, 곧 사라진다), unapplied(적용되지 않았다는 것만 알림, 이유 미상),
 * switching(엔진 대상을 바꾸는 중이라 보내지 않았다, 새 엔진이 붙으면 다시 누른다)
 */
export type ApprovalFailure = "failed" | "invalid" | "closed" | "unapplied" | "switching";
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

/** 동작 슬래시 명령(`command.run`의 `done`)이 낸 출력. 화면이 대화 옆에 보이고 사용자가 닫는다 */
export type CommandOutput = {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly message: string | null;
  readonly result: JsonValue;
};

/** 셸 주입이 있는 명령이 사람의 확인을 기다린다. 확인하면 `text`를 `confirmShell: true`로 다시 보낸다 */
type ShellConfirm = {
  readonly threadId: ThreadId;
  readonly name: string;
  /** 실행될 셸 명령(줄 순서) */
  readonly commands: readonly string[];
  /** 사용자가 친 줄 그대로 */
  readonly text: string;
  /** 확인 뒤 템플릿이 펼쳐져 `turn.start`로 갈 때 쓰는 요청 id */
  readonly requestId: string;
};

/**
 * 입력창에 대한 요청(⌘L과 명령 팔레트의 슬래시 명령). `insert`가 글이면 입력창이 비어 있을 때만 채우고, null이면 초점만 준다.
 * 입력창이 받으면 `settleComposerRequest`로 지운다. 입력창이 아직 없으면 요청은 입력창이 생길 때 받는다.
 */
export type ComposerRequest = { readonly insert: string | null };

/** 변경 검토 화면(P-04)이 여는 검토 승인. 화면은 이 승인이 대기열에 있는 동안 보이고, 해결되면 같은 리뷰의 다음 라운드를 따라간다 */
export type ReviewTarget = { readonly approvalId: EventId; readonly reviewId: string };

/** 설정 화면이 열며 옮길 탭과 항목. `key`가 null이면 탭만 연다. 화면이 받으면 `settleSettingsJump`로 지운다 */
export type SettingsJump = { readonly tab: SettingsTab; readonly key: SettingKey | null };

/**
 * 다시 시작해야 적용되는 일 하나. 설치 결과(`appliesAt: restart`)와 되돌리기(`restart`)가 만든다.
 * 같은 종류와 이름은 한 번만 든다(`noteRestartNeeded`가 거른다).
 */
export type RestartReason = { readonly kind: "install" | "rollback"; readonly name: string };

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
  /** 슬래시 명령이 낸 출력. 닫기 전까지 있다 */
  readonly commandOutput: CommandOutput | null;
  /** 셸 주입 확인 대기. 열려 있는 동안만 있다 */
  readonly shellConfirm: ShellConfirm | null;
  /** 엔진 대상을 바꾸는 중(W-08). 쓰기 명령이 보류되고 입력창이 이를 알린다 */
  readonly engineSwitching: boolean;
  /** 입력창에 줄 요청. 받기 전까지 있다 */
  readonly composerRequest: ComposerRequest | null;
  /** 설정 화면에 줄 탭과 항목. 화면이 받기 전까지 있다 */
  readonly settingsJump: SettingsJump | null;
  /** 변경 검토 화면이 여는 검토 승인. 승인 카드의 "검토 열기"가 정한다 */
  readonly reviewTarget: ReviewTarget | null;
  /** 다시 시작해야 적용되는 일. 엔진이 다시 running으로 돌아오면 비운다(app/restart-needed.ts) */
  readonly restartNeeded: readonly RestartReason[];
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
  showCommandOutput(output: CommandOutput): void;
  dismissCommandOutput(): void;
  askShellConfirm(confirm: ShellConfirm): void;
  clearShellConfirm(): void;
  setEngineSwitching(switching: boolean): void;
  requestComposer(insert: string | null): void;
  settleComposerRequest(): void;
  /** 설정 화면을 열고 그 탭과 항목으로 옮길 요청을 남긴다 */
  requestSettingsJump(jump: SettingsJump): void;
  settleSettingsJump(): void;
  /** 변경 검토 화면을 이 승인으로 연다. 화면 자리는 App이 옮긴다 */
  openReview(target: ReviewTarget): void;
  /** 다시 시작이 필요한 일을 더한다. 같은 종류와 이름이 있으면 상태를 바꾸지 않는다 */
  noteRestartNeeded(reason: RestartReason): void;
  /** 다시 시작이 필요한 일을 모두 지운다. 같은 상태(빈 목록)면 상태를 바꾸지 않는다 */
  clearRestartNeeded(): void;
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
  commandOutput: null,
  shellConfirm: null,
  engineSwitching: false,
  composerRequest: null,
  settingsJump: null,
  reviewTarget: null,
  restartNeeded: [],
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
    showCommandOutput: (commandOutput) => api.setState({ commandOutput }),
    dismissCommandOutput: () => api.setState({ commandOutput: null }),
    askShellConfirm: (shellConfirm) => api.setState({ shellConfirm }),
    clearShellConfirm: () => api.setState({ shellConfirm: null }),
    setEngineSwitching: (engineSwitching) => api.setState({ engineSwitching }),
    requestComposer: (insert) => api.setState({ composerRequest: { insert } }),
    settleComposerRequest: () => api.setState({ composerRequest: null }),
    requestSettingsJump: (settingsJump) => api.setState({ screen: "settings", settingsJump }),
    settleSettingsJump: () => api.setState({ settingsJump: null }),
    openReview: (reviewTarget) => api.setState({ reviewTarget }),
    noteRestartNeeded: (reason) =>
      api.setState((s) =>
        s.restartNeeded.some((r) => r.kind === reason.kind && r.name === reason.name)
          ? s
          : { restartNeeded: [...s.restartNeeded, reason] },
      ),
    clearRestartNeeded: () =>
      api.setState((s) => (s.restartNeeded.length === 0 ? s : { restartNeeded: [] })),
    setObserving: (id, observing) =>
      api.setState((s) => {
        if ((s.observing[id] === true) === observing) return s;
        const { [id]: _old, ...rest } = s.observing;
        return { observing: observing ? { ...rest, [id]: true } : rest };
      }),
  };
  return { read: readonlyView(api), actions };
}
