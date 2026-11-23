import { t } from "@fresnel/client/i18n";
import { assertNever, type Result } from "@fresnel/contracts";
import type { EngineState, Link, QueuedInput } from "../state/engine/index.ts";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { BusyInputMode, CommandError } from "./commands.ts";
import { setupRequiredText } from "./setup-needed.ts";

// 입력창의 Enter 판정과 중복 전송 방지. 화면 부품에서 떼어 순수하게 시험한다.
// 기본은 Enter 보내기, Shift+Enter 줄바꿈이다(L4.desktop-ux DP-133 [결정: 2026-11-12 사용자]).
// 한글 조합 중 Enter 한 번은 "글자 확정 + 보내기"다. 브라우저마다 이 한 번이 여러 이벤트로 온다:
// - Chromium(Electron): keydown(isComposing 참, keyCode 229) → compositionend → 같은 키의 keydown(Enter, 13)이 한 번 더 온다.
// - WebKit: compositionend → keydown(isComposing 거짓, keyCode 229).
// 그래서 조합 중 Enter는 무장(arm)만 하고 compositionend에서 보낸다. 확정 직후 뒤따라오는 Enter는 삼킨다(줄바꿈도 두 번째 전송도 없게).

export type EnterKeyInput = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
};

/** keydown 하나에 대한 처리. send = 막고 보낸다, swallow = 막기만 한다, pass = 브라우저(IME, 줄바꿈)에 맡긴다 */
type EnterAction = "send" | "swallow" | "pass";

export type EnterGuard = {
  compositionStart(): void;
  /** nowMs는 이벤트 시각(event.timeStamp)이다. 참이면 조합 중 Enter가 눌렸으니 확정된 글을 지금 보낸다 */
  compositionEnd(nowMs: number): boolean;
  keyDown(event: EnterKeyInput, nowMs: number): EnterAction;
};

/** compositionend 직후 이 시간 안에 오는 Enter는 확정에 딸린 키다 */
export const COMPOSITION_END_GRACE_MS = 100;
/** 조합 중 Enter를 누른 뒤 이 시간 안에 조합이 끝나면 보낸다. 끝이 오지 않은 무장은 버린다 */
export const COMPOSITION_ARM_MS = 1000;
const IME_PROCESS_KEY_CODE = 229;

export function createEnterGuard(): EnterGuard {
  let composing = false;
  let endedAt = Number.NEGATIVE_INFINITY;
  let armedAt = Number.NEGATIVE_INFINITY;
  // 마지막 compositionend가 보냈는가(그러면 뒤따르는 Enter는 삼킨다)
  let sentAtEnd = false;
  return {
    compositionStart() {
      composing = true;
    },
    compositionEnd(nowMs) {
      composing = false;
      endedAt = nowMs;
      sentAtEnd = nowMs - armedAt <= COMPOSITION_ARM_MS;
      armedAt = Number.NEGATIVE_INFINITY;
      return sentAtEnd;
    },
    keyDown(event, nowMs) {
      if (event.key !== "Enter" || event.shiftKey) {
        armedAt = Number.NEGATIVE_INFINITY;
        return "pass";
      }
      // 조합 중: IME가 글자를 확정하게 두고 compositionend에서 보낸다
      if (composing || event.isComposing) {
        armedAt = nowMs;
        return "pass";
      }
      const afterEnd = nowMs - endedAt <= COMPOSITION_END_GRACE_MS;
      if (afterEnd) return sentAtEnd ? "swallow" : "send";
      // 조합 이벤트 없이 229만 온 키: IME가 처리 중이다. 끝나면 보낸다
      if (event.keyCode === IME_PROCESS_KEY_CODE) {
        armedAt = nowMs;
        return "pass";
      }
      return "send";
    },
  };
}

/** 한 번에 하나만 실행하는 잠금. 상태(setState)는 비동기라 연속 입력을 못 막으므로 ref 값으로 막는다 */
export type SendLatch = { tryAcquire(): boolean; release(): void };

export function createSendLatch(): SendLatch {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

/**
 * 보내기 Enter가 실행 중 입력을 넣을 자리. 그냥 Enter는 대기열(턴이 끝난 뒤, `followUp`)이고 ⌘Enter(Windows·Linux는 Ctrl+Enter)는
 * 도는 턴에 바로 반영(`steer`)한다. 도는 턴이 없으면 두 키 모두 그냥 보낸다.
 */
export function busyModeOfEnter(event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): BusyInputMode {
  return event.metaKey || event.ctrlKey ? "steer" : "followUp";
}

/** 대기 입력을 지금 반영할 수 있는가. 끝난 뒤 자리의 입력만이고, 이미 바로 반영 자리이거나 곁가지(aside)면 아니다 */
export function steerableQueuedMode(mode: QueuedInput["mode"]): boolean {
  return mode === "followUp" || mode === "next";
}

/** 입력창을 잠그는 이유. null이면 보낼 수 있다 */
export function composerDisabledReason(input: {
  readonly engineRunning: boolean;
  readonly phase: Link["phase"];
  readonly observing: boolean;
  readonly setupNeeded: boolean;
}): string | null {
  if (!input.engineRunning) return t("desktop.composer.disabled.engineOff");
  if (input.phase !== "live" && input.phase !== "syncing")
    return t("desktop.composer.disabled.syncing");
  if (input.observing) return t("desktop.composer.disabled.observing");
  if (input.setupNeeded) return setupRequiredText();
  return null;
}

/**
 * 엔진이 없는가. 엔진이 돌고 있지 않거나(꺼짐, 다시 시작 중, 실패, 아직 모름) 연결이 끊기면 없다. 연결이 끊기면 거울의 값(실행 중 대화 등)은
 * 오래된 것이라 "진행 중"이라고 말하지 않는다. 상태 표시줄의 "진행 중 n" 칸과 입력창의 정지 단추가 쓴다
 */
export function engineGoneOf(engine: EngineState | null, phase: Link["phase"]): boolean {
  return engine?.kind !== "running" || phase === "offline" || phase === "failed";
}

/** 정지 단추를 못 누르게 하는 이유. 엔진이 없으면 그 이유를, 있으면 null이다(정지를 누를 수 있다) */
export function stopBlockedReasonOf(engineGone: boolean): string | null {
  return engineGone ? t("desktop.composer.stop.engineOff") : null;
}

/** 입력창 위 대기 입력 칩 하나의 철회 상태. `withdrawn`과 `placed`는 결과 값이고, 칩은 `input.placed`·`input.withdrawn` 사실로 사라진다 */
export type WithdrawState =
  | { readonly status: "idle" }
  | { readonly status: "withdrawing" }
  | { readonly status: "withdrawn" }
  | { readonly status: "placed" }
  | { readonly status: "failed"; readonly message: string };

/**
 * 칩에 보이는 대기 입력: 사용자와 확장의 입력만 칩이 되고, 화면에 그리지 않는 내부 지시(`display: false`)는 칩이 되지 않는다. 위임 완료 보고와 예약 입력은 칩으로 보이지 않는다.
 * Helm 안내(`grp.helm.*` 맥락 알림, `when: "next"`)도 칩이 아니다: 다음 턴에 저절로 붙고 사용자가 할 일이 없어서, 탐구가 끝난 뒤에도
 * "대기 중인 메시지"로 남아 보이던 것을 없앤다(AGE-77 F-42)
 */
export function chipInputs(list: readonly QueuedInput[]): readonly QueuedInput[] {
  return list.filter(
    (input) =>
      (input.sourceType === "user" || input.sourceType === "extension") &&
      !(input.preview.kind === "label" && input.preview.internal === true) &&
      !(input.preview.kind === "label" && input.preview.labelKey === "helm"),
  );
}

/**
 * 혼자서 턴을 열 수 있는 대기 입력인가. steer·followUp만이다. next·aside는 다음 턴에 붙기만 하고 스스로 시작하지 않는다
 * (`L1.tasks.spec` §4.9 B안). Helm 안내처럼 확장이 `when: "next"`로 넣은 입력이 여기에 든다
 */
export function startableQueuedMode(mode: QueuedInput["mode"]): boolean {
  return mode === "steer" || mode === "followUp";
}

/**
 * 멈춘 뒤 보내기를 기다리는 대기 입력 수(DP-156). 대화가 쉬고 있고(복구 표식 없음) 스스로 턴을 열 수 있는 칩만 센다.
 * 엔진은 사용자가 중단한 대화의 큐를 자동으로 시작하지 않으므로, 쉬는 대화에 남은 시작 가능 입력은 보내기(`turn.resume`)를 기다린다.
 * next·aside는 세지 않는다: `turn.resume`이 그것으로 턴을 열지 않아 보내기가 아무 일도 하지 않는다
 */
export function heldCountOf(
  thread: Pick<ThreadSummary, "status" | "resumable"> | undefined,
  chips: readonly QueuedInput[],
): number {
  if (thread === undefined || thread.status !== "idle" || thread.resumable !== null) return 0;
  return chips.filter((input) => startableQueuedMode(input.mode)).length;
}

/** 대기 입력의 모드를 칩 툴팁의 말로 옮긴다. 멈춘 뒤의 시작 가능 입력(`held`)은 보내기를 기다린다고 말한다 */
export function queuedModeText(mode: QueuedInput["mode"], held = false): string {
  if (held && startableQueuedMode(mode)) return t("desktop.composer.queue.mode.held");
  switch (mode) {
    case "steer":
      return t("desktop.composer.queue.mode.steer");
    case "followUp":
      return t("desktop.composer.queue.mode.followUp");
    case "next":
      return t("desktop.composer.queue.mode.next");
    case "aside":
      return t("desktop.composer.queue.mode.aside");
    default:
      return assertNever(mode, "QueuedInput.mode");
  }
}

/** 칩의 입력 미리보기. 글이면 글을, 글이 없는 항목이면 이름표를 쓴다 */
export function queuedPreviewText(preview: QueuedInput["preview"]): string {
  if (preview.kind === "text") return preview.text;
  switch (preview.labelKey) {
    case "image":
      return t("desktop.composer.queue.preview.image");
    case "context":
      return t("desktop.composer.queue.preview.context");
    case "helm":
      return t("desktop.composer.queue.preview.helm");
    case "empty":
      return t("desktop.composer.queue.preview.empty");
    default:
      return assertNever(preview.labelKey, "QueuedPreview.labelKey");
  }
}

/**
 * `turn.withdraw` 결과를 칩의 상태로 옮긴다. 잠김은 대화 상자(`showLocked`)가 맡으므로 칩은 처음 상태로 돌아가 다시 누를 수 있다.
 * 그 밖의 실패는 칩 안에 글과 다시 시도 단추를 둔다.
 */
export function withdrawStateOf(result: Result<boolean, CommandError>): WithdrawState {
  if (result.ok) return result.value ? { status: "withdrawn" } : { status: "placed" };
  const error = result.error;
  if (error.kind === "locked") return { status: "idle" };
  return { status: "failed", message: withdrawFailureText(error) };
}

function withdrawFailureText(error: Exclude<CommandError, { readonly kind: "locked" }>): string {
  switch (error.kind) {
    case "offline":
      return t("desktop.composer.error.offline");
    case "switching":
      return t("desktop.composer.error.switching");
    case "not_available":
    case "unsupported":
      return t("desktop.composer.error.unsupported");
    case "rejected":
      return error.code === null
        ? t("desktop.composer.queue.withdraw.failed")
        : t("desktop.composer.error.rejected", { code: error.code });
    case "failed":
      return t("desktop.composer.queue.withdraw.failed");
    default:
      return assertNever(error, "CommandError");
  }
}

// 비밀처럼 보이는 값을 가리는 패턴. 값 자체는 어디에도 남기지 않고 모양만 본다.
const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/,
  /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*[\u0022\u0027]?[A-Za-z0-9._~+/-]{12,}/i,
];

/** 입력 글이 비밀 값(API 키, 토큰, 개인 키 등)처럼 보이는가. 입력창 위 경고 한 줄을 보일지 정한다 */
export function looksLikeSecret(text: string): boolean {
  return SECRET_SHAPES.some((shape) => shape.test(text));
}
