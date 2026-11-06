import { t } from "@fresnel/client/i18n";
import { assertNever, type Result } from "@fresnel/contracts";
import type { Link, QueuedInput } from "../state/engine/index.ts";
import type { BusyInputMode, CommandError } from "./commands.ts";
import { setupRequiredText } from "./setup-needed.ts";

// 입력창의 Enter 판정과 중복 전송 방지. 화면 부품에서 떼어 순수하게 시험한다.
// WebKit(Safari, WKWebView)은 한글 조합 중 Enter에서 compositionend를 keydown보다 먼저 내고,
// 그 keydown은 isComposing이 거짓이지만 keyCode가 229다. 그래서 세 단서를 모두 본다.

export type EnterKeyInput = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
};

export type EnterGuard = {
  compositionStart(): void;
  /** nowMs는 이벤트 시각(event.timeStamp)이다 */
  compositionEnd(nowMs: number): void;
  /** 이 keydown이 "보내기" Enter인가 */
  isSendEnter(event: EnterKeyInput, nowMs: number): boolean;
};

/** compositionend 직후 이 시간 안의 Enter는 조합을 확정한 키다 */
export const COMPOSITION_END_GRACE_MS = 50;
const IME_PROCESS_KEY_CODE = 229;

export function createEnterGuard(): EnterGuard {
  let composing = false;
  let endedAt = Number.NEGATIVE_INFINITY;
  return {
    compositionStart() {
      composing = true;
    },
    compositionEnd(nowMs) {
      composing = false;
      endedAt = nowMs;
    },
    isSendEnter(event, nowMs) {
      if (event.key !== "Enter" || event.shiftKey) return false;
      if (composing || event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE) return false;
      return nowMs - endedAt > COMPOSITION_END_GRACE_MS;
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
 * 입력창 모드 단추가 내는 값을 `BusyInputMode`로 좁힌다. 알 수 없는 값은 null이라 호출하는 쪽이 고르지 않는다(단언 없이).
 */
export function busyModeOf(value: string): BusyInputMode | null {
  if (value === "steer" || value === "followUp") return value;
  return null;
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

/** 입력창 위 대기 입력 칩 하나의 철회 상태. `withdrawn`과 `placed`는 결과 값이고, 칩은 `input.placed`·`input.withdrawn` 사실로 사라진다 */
export type WithdrawState =
  | { readonly status: "idle" }
  | { readonly status: "withdrawing" }
  | { readonly status: "withdrawn" }
  | { readonly status: "placed" }
  | { readonly status: "failed"; readonly message: string };

/** 칩에 보이는 대기 입력: 사용자와 확장의 입력만 칩이 되고, 화면에 그리지 않는 내부 지시(`display: false`)는 칩이 되지 않는다. 위임 완료 보고와 예약 입력은 칩으로 보이지 않는다 */
export function chipInputs(list: readonly QueuedInput[]): readonly QueuedInput[] {
  return list.filter(
    (input) =>
      (input.sourceType === "user" || input.sourceType === "extension") &&
      !(input.preview.kind === "label" && input.preview.internal === true),
  );
}

/** 대기 입력의 모드를 칩의 짧은 말로 옮긴다. 다음 턴 경계 뒤 들어가는 followUp과 next는 같은 말이다 */
export function queuedModeText(mode: QueuedInput["mode"]): string {
  switch (mode) {
    case "steer":
      return t("desktop.composer.queue.mode.steer");
    case "followUp":
    case "next":
      return t("desktop.composer.queue.mode.followUp");
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
