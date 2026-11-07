// 앱 업데이트 화면의 순수 모델(B-10). 상태 합집합과 이벤트 리듀서, 상태 칸과 설정 줄의 모양, 확인과 설치의 허용 규칙,
// 실패 이유의 문구 표를 둔다. 명령은 `update-invoke.ts`가, 상태 보관과 호출 순서는 `update-controller.ts`가 맡는다.
// 이 파일은 React와 셸을 보지 않는다. 시험은 값을 비교한다(test/views/update-model.test.ts).
import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { StatusDot } from "./status-cell.tsx";

/** 실패가 난 단계. 확인, 내려받기, 설치 가운데 하나다 */
export type UpdateStage = "check" | "download" | "install";

/** 실패 이유 코드. Rust `updater.rs`의 `reason` 값과 같다. 모르는 코드는 `other`로 읽는다 */
export type UpdateReason =
  | "signature"
  | "no_release"
  | "network"
  | "busy"
  | "nothing_to_download"
  | "nothing_to_install"
  | "config"
  | "other";

export const UPDATE_REASONS: readonly UpdateReason[] = [
  "signature",
  "no_release",
  "network",
  "busy",
  "nothing_to_download",
  "nothing_to_install",
  "config",
  "other",
];

/**
 * 업데이트 상태. 새 버전 정보(`version`, `notes`)는 찾은 뒤부터 설치가 끝나거나 실패할 때까지 든다.
 * 확인 단계의 실패와 오프라인에는 버전이 없어 `null`이다(내려받기 단계부터 버전을 안다).
 */
export type UpdateState =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "checking" }
  | { readonly kind: "current" }
  | { readonly kind: "available"; readonly version: string; readonly notes: string | null }
  | {
      readonly kind: "downloading";
      readonly version: string;
      readonly notes: string | null;
      readonly downloaded: number;
      /** 전체 크기를 모르면 `null`이다. 이때 진행 막대는 모양만 돈다 */
      readonly total: number | null;
    }
  | { readonly kind: "ready"; readonly version: string; readonly notes: string | null }
  | { readonly kind: "installing"; readonly version: string; readonly notes: string | null }
  | {
      readonly kind: "failed";
      readonly stage: UpdateStage;
      readonly reason: UpdateReason;
      readonly version: string | null;
      readonly notes: string | null;
    }
  | {
      readonly kind: "offline";
      readonly stage: UpdateStage;
      readonly version: string | null;
      readonly notes: string | null;
    };

export const INITIAL_UPDATE_STATE: UpdateState = { kind: "checking" };

/** 찾은 새 버전의 정보 */
export type UpdateTarget = { readonly version: string; readonly notes: string | null };

/** 확인 한 번의 결과. 화면이 아는 모양으로 바꾼 것이다(`update-invoke.ts`가 만든다) */
export type CheckOutcome =
  | { readonly kind: "notConfigured" }
  | { readonly kind: "upToDate" }
  | { readonly kind: "available"; readonly version: string; readonly notes: string | null }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly reason: UpdateReason };

/** 내려받기 한 번의 결과. 성공하면 `ready`다 */
export type DownloadOutcome =
  | { readonly kind: "ready" }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly reason: UpdateReason };

/** 설치 한 번의 결과. 성공하면 앱이 다시 시작되어 돌아오지 않으므로 답은 실패뿐이다 */
export type InstallOutcome =
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly reason: UpdateReason };

export type UpdateEvent =
  | { readonly kind: "checkStarted" }
  | { readonly kind: "checkFinished"; readonly outcome: CheckOutcome }
  | { readonly kind: "downloadStarted" }
  | { readonly kind: "progress"; readonly downloaded: number; readonly total: number | null }
  | { readonly kind: "downloadFinished"; readonly outcome: DownloadOutcome }
  | { readonly kind: "installStarted" }
  | { readonly kind: "installFinished"; readonly outcome: InstallOutcome };

/** 확인을 시작할 수 있는 상태. 설정이 안 됐거나 내려받는 중, 설치 중이면 아니다 */
const CHECKABLE: ReadonlySet<UpdateState["kind"]> = new Set<UpdateState["kind"]>([
  "current",
  "available",
  "ready",
  "failed",
  "offline",
]);

/** 상태가 가진 새 버전. 버전을 모르는 상태(확인 단계, 최신, 설정 안 됨)는 `null`이다 */
export function updateTargetOf(state: UpdateState): UpdateTarget | null {
  switch (state.kind) {
    case "available":
    case "downloading":
    case "ready":
    case "installing":
      return { version: state.version, notes: state.notes };
    case "failed":
    case "offline":
      return state.version === null ? null : { version: state.version, notes: state.notes };
    case "unconfigured":
    case "checking":
    case "current":
      return null;
    default:
      return assertNever(state, "UpdateState");
  }
}

/** 확인을 시작할 수 있는가. 확인, 내려받기, 설치가 도는 동안과 설정이 안 된 상태에서는 아니다 */
export function canCheck(state: UpdateState): boolean {
  return CHECKABLE.has(state.kind);
}

/** 내려받을 수 있는가. 찾은 뒤(`available`)이거나 내려받기 단계에서 멈춘 뒤 다시 시도하는 경우다 */
export function canDownload(state: UpdateState): boolean {
  if (state.kind === "available") return true;
  return (
    (state.kind === "failed" || state.kind === "offline") &&
    state.stage === "download" &&
    state.version !== null
  );
}

/** 설치할 수 있는가. 내려받아 준비된 뒤(`ready`)이거나 설치 단계에서 멈춘 뒤 다시 시도하는 경우다 */
export function canInstall(state: UpdateState): boolean {
  if (state.kind === "ready") return true;
  return (
    (state.kind === "failed" || state.kind === "offline") &&
    state.stage === "install" &&
    state.version !== null
  );
}

/** 실패나 오프라인에서 다시 시도할 단계. 실패와 오프라인이 아니면 `null`이다 */
export function retryStepOf(state: UpdateState): UpdateStage | null {
  if (state.kind === "failed" || state.kind === "offline") return state.stage;
  return null;
}

/** "다시 시도" 단추를 보일지. 실패나 오프라인에서만 보인다 */
export function canRetry(state: UpdateState): boolean {
  return retryStepOf(state) !== null;
}

/**
 * 설치 전에 진행 중인 턴을 묻는지. 턴이 있고 설치할 수 있는 상태면 묻는다. 턴이 없으면 바로 다시 시작한다.
 * 확인과 내려받기는 턴을 멈추지 않으므로 묻지 않는다.
 */
export function needsRunningConfirm(state: UpdateState, runningCount: number): boolean {
  return runningCount > 0 && canInstall(state);
}

/**
 * 턴이 끝나면 설치하기로 한 것이 지금 설치해도 되는가. 턴이 0이고 파일이 준비된(`ready`) 때만 한 번 설치한다.
 * 실패한 설치는 `ready`가 아니므로 자동으로 다시 설치하지 않는다.
 */
export function shouldAutoInstall(
  afterTurnRequested: boolean,
  runningCount: number,
  state: UpdateState,
): boolean {
  return afterTurnRequested && runningCount === 0 && state.kind === "ready";
}

/** 내려받기 퍼센트. 전체 크기를 모르면 `null`이다. 0~100 정수로 자른다 */
export function progressPercentOf(state: UpdateState): number | null {
  if (state.kind !== "downloading" || state.total === null || state.total <= 0) return null;
  const ratio = Math.floor((state.downloaded * 100) / state.total);
  return Math.min(100, Math.max(0, ratio));
}

/**
 * 상태 리듀서. 맞지 않는 순서의 이벤트는 상태를 그대로 돌려준다(같은 객체).
 * 확인은 `CHECKABLE`일 때만 시작되고, 확인 결과는 `checking`에서만 받는다. 내려받기와 설치도 같은 방식이다.
 */
export function reduceUpdate(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.kind) {
    case "checkStarted":
      if (state.kind === "checking") return state;
      return canCheck(state) ? { kind: "checking" } : state;
    case "checkFinished":
      return state.kind === "checking" ? checkedOf(event.outcome) : state;
    case "downloadStarted": {
      const target = updateTargetOf(state);
      if (target === null || !canDownload(state)) return state;
      return { kind: "downloading", ...target, downloaded: 0, total: null };
    }
    case "progress":
      return state.kind === "downloading"
        ? { ...state, downloaded: event.downloaded, total: event.total }
        : state;
    case "downloadFinished":
      return state.kind === "downloading" ? downloadedOf(state, event.outcome) : state;
    case "installStarted": {
      const target = updateTargetOf(state);
      if (target === null || !canInstall(state)) return state;
      return { kind: "installing", ...target };
    }
    case "installFinished":
      return state.kind === "installing" ? installedOf(state, event.outcome) : state;
    default:
      return assertNever(event, "UpdateEvent");
  }
}

function checkedOf(outcome: CheckOutcome): UpdateState {
  switch (outcome.kind) {
    case "notConfigured":
      return { kind: "unconfigured" };
    case "upToDate":
      return { kind: "current" };
    case "available":
      return { kind: "available", version: outcome.version, notes: outcome.notes };
    case "offline":
      return { kind: "offline", stage: "check", version: null, notes: null };
    case "failed":
      return { kind: "failed", stage: "check", reason: outcome.reason, version: null, notes: null };
    default:
      return assertNever(outcome, "CheckOutcome");
  }
}

function downloadedOf(
  state: Extract<UpdateState, { kind: "downloading" }>,
  outcome: DownloadOutcome,
): UpdateState {
  const target = { version: state.version, notes: state.notes };
  switch (outcome.kind) {
    case "ready":
      return { kind: "ready", ...target };
    case "offline":
      return { kind: "offline", stage: "download", ...target };
    case "failed":
      return { kind: "failed", stage: "download", reason: outcome.reason, ...target };
    default:
      return assertNever(outcome, "DownloadOutcome");
  }
}

function installedOf(
  state: Extract<UpdateState, { kind: "installing" }>,
  outcome: InstallOutcome,
): UpdateState {
  const target = { version: state.version, notes: state.notes };
  switch (outcome.kind) {
    case "offline":
      return { kind: "offline", stage: "install", ...target };
    case "failed":
      return { kind: "failed", stage: "install", reason: outcome.reason, ...target };
    default:
      return assertNever(outcome, "InstallOutcome");
  }
}

/** 상태 칸의 모양. `showCell`이 거짓이면 칸은 그리지 않는다(설정 줄이 상태를 보인다) */
export interface UpdateCell {
  readonly text: MessageId;
  readonly dot: StatusDot;
  readonly showCell: boolean;
}

function cellOf(text: MessageId, dot: StatusDot, showCell: boolean): UpdateCell {
  return { text, dot, showCell };
}

/**
 * 상태 칸(d02 `upd`). 내려받기와 설치 단계에서만 보인다. 확인 단계, 최신, 설정 안 됨에서는 숨기고 설정 줄이 상태를 보인다.
 * 새 버전이 있으면 중립이 아니라 성공 점이다(시안과 같다). 실패는 위험, 연결이 끊긴 것은 경고 점이다.
 */
export function updateCellOf(state: UpdateState): UpdateCell {
  switch (state.kind) {
    case "unconfigured":
      return cellOf("desktop.update.cell.unconfigured", "neutral", false);
    case "checking":
      return cellOf("desktop.update.cell.checking", "neutral", false);
    case "current":
      return cellOf("desktop.update.cell.current", "success", false);
    case "available":
      return cellOf("desktop.update.cell.available", "success", true);
    case "downloading":
      return cellOf(
        progressPercentOf(state) === null
          ? "desktop.update.cell.downloadingUnknown"
          : "desktop.update.cell.downloading",
        "success",
        true,
      );
    case "ready":
      return cellOf("desktop.update.cell.ready", "success", true);
    case "installing":
      return cellOf("desktop.update.cell.installing", "success", true);
    case "failed":
      return cellOf("desktop.update.cell.failed", "danger", true);
    case "offline":
      return cellOf("desktop.update.cell.offline", "warning", state.stage !== "check");
    default:
      return assertNever(state, "UpdateState");
  }
}

/** 설정 줄의 상태 문구. 글 id와 인자를 함께 준다(`t(text, args)`) */
export interface UpdateLine {
  readonly text: MessageId;
  readonly args: MessageArgs;
}

/** 설정 줄의 상태 문구. 실패는 이유 문구를 그대로 보인다 */
export function updateLineOf(state: UpdateState): UpdateLine {
  switch (state.kind) {
    case "unconfigured":
      return { text: "desktop.update.line.unconfigured", args: {} };
    case "checking":
      return { text: "desktop.update.line.checking", args: {} };
    case "current":
      return { text: "desktop.update.line.current", args: {} };
    case "available":
      return { text: "desktop.update.line.available", args: { version: state.version } };
    case "downloading": {
      const percent = progressPercentOf(state);
      return percent === null
        ? { text: "desktop.update.line.downloadingUnknown", args: {} }
        : { text: "desktop.update.line.downloading", args: { percent } };
    }
    case "ready":
      return { text: "desktop.update.line.ready", args: {} };
    case "installing":
      return { text: "desktop.update.line.installing", args: {} };
    case "failed":
      return { text: reasonTextOf(state.reason), args: {} };
    case "offline":
      return { text: "desktop.update.offline", args: {} };
    default:
      return assertNever(state, "UpdateState");
  }
}

const REASON_TEXT: Readonly<Record<UpdateReason, MessageId>> = {
  signature: "desktop.update.reason.signature",
  no_release: "desktop.update.reason.noRelease",
  network: "desktop.update.reason.network",
  busy: "desktop.update.reason.busy",
  nothing_to_download: "desktop.update.reason.nothingToDownload",
  nothing_to_install: "desktop.update.reason.nothingToInstall",
  config: "desktop.update.reason.config",
  other: "desktop.update.reason.other",
};

/** 실패 이유 코드의 사용자 문구. 서명 불일치는 설치하지 않았고 지금 버전이 그대로라는 것을 말한다 */
export function reasonTextOf(reason: UpdateReason): MessageId {
  return REASON_TEXT[reason];
}

/** 상태 Popover의 설명 한 줄. 설명이 없는 상태는 `undefined`다(실패와 오프라인은 경고 글이 맡는다) */
export function updateDescriptionOf(state: UpdateState): MessageId | undefined {
  switch (state.kind) {
    case "available":
      return "desktop.update.popover.availableDesc";
    case "ready":
      return "desktop.update.popover.readyDesc";
    case "unconfigured":
    case "checking":
    case "current":
    case "downloading":
    case "installing":
    case "failed":
    case "offline":
      return undefined;
    default:
      return assertNever(state, "UpdateState");
  }
}

/** 바뀐 점에서 보일 줄 수의 상한 */
const NOTES_MAX_LINES = 3;

/** 바뀐 점에서 보일 줄. 줄 단위로 나누고 앞뒤 빈칸과 목록 기호를 떼며 최대 `NOTES_MAX_LINES`줄이다 */

export function notesLinesOf(notes: string | null): readonly string[] {
  if (notes === null) return [];
  return notes
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line !== "")
    .slice(0, NOTES_MAX_LINES);
}

/** Popover 본문에서 누를 단추의 종류. 단추가 없는 상태는 `null`이다 */
export type UpdateAction = "download" | "install" | "retry";

export function primaryActionOf(state: UpdateState): UpdateAction | null {
  if (state.kind === "available") return "download";
  if (state.kind === "ready") return "install";
  return canRetry(state) ? "retry" : null;
}
