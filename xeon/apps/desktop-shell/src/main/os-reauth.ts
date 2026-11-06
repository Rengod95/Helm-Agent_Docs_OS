// `os_reauth` 명령(L4.desktop.spec §4.17)의 순수 로직. Rust `os_reauth.rs`의 사유 문구, 오류 분류, 결과 로그를 옮긴다.
// 이 파일은 electron을 import하지 않는다. 실제 Touch ID 호출과 시계, 로그는 os-reauth-shell.ts가 ports로 넘긴다.
//
// [알려진 차이] Electron의 `systemPreferences.promptTouchID`는 Touch ID(생체) 전용이다.
// Rust 원본은 `LAPolicy.DeviceOwnerAuthentication`이라 Touch ID가 실패하면 기기 암호 창으로 넘어갈 수 있었다.
// 이 API에는 그 대체 경로가 없다. Touch ID가 없는 맥은 `unavailable`이 된다. 기기 암호까지 쓰려면 네이티브 addon이 필요하며, 그 결정은 사용자가 한다(여기서 임의로 넣지 않았다).

import { attempt, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { CommandHandler, ShellContext, ShellModule } from "./context.ts";

/** 사유 문구의 상한(코드 포인트 수). 시스템 창에 한 줄로 들어가는 길이다 */
const MAX_REASON_CHARS = 120;
/** 사유가 비었을 때 창에 보이는 문구 */
const DEFAULT_REASON = "Fresnel";

/** Rust `ReauthError`와 같은 네 종류. renderer는 `{ kind }` 객체로 받는다 */
export type ReauthKind = "cancelled" | "denied" | "unavailable" | "failed";

/** 인증 증거. `verifiedAtMs`는 인증이 끝난 시각(epoch 밀리초)이다. 셸은 시각을 저장하지 않는다 */
export interface ReauthGrant {
  readonly verifiedAtMs: number;
}

/** 명령이 쓰는 바깥 세계. 시험은 가짜를 넣고, 어댑터는 Electron, 시계, 앱 로그를 잇는다 */
export interface OsReauthPorts {
  readonly platform: NodeJS.Platform;
  /** Touch ID 창을 띄울 수 있는지. macOS에서만 부른다 */
  canPromptTouchID(): boolean;
  /** Touch ID 창을 띄운다. 인증되면 이행하고, 거절이나 취소는 거부로 온다 */
  promptTouchID(reason: string): Promise<void>;
  /** 인증이 끝난 시각(epoch 밀리초) */
  now(): number;
  /** 한 줄 로그. 사유와 값은 넘기지 않는다 */
  log(line: string): void;
}

/**
 * 시스템 창에 보일 문구. 제어 문자는 공백으로 바꾸고, 공백 연속은 한 칸으로 줄이고, 120 코드 포인트로 자른다.
 * 자른 뒤 끝에 남는 공백은 뗀다. 비면 "Fresnel"이다.
 */
export function promptText(reason: string): string {
  const words = reason
    .replaceAll(/\p{Cc}/gu, " ")
    .split(/\p{White_Space}+/u)
    .filter((word) => word !== "");
  const text = words.join(" ");
  if (text === "") return DEFAULT_REASON;
  return Array.from(text).slice(0, MAX_REASON_CHARS).join("").trimEnd();
}

// 문구는 LAError의 영문 설명을 따른다. "system cancel"과 "app cancel"도 "cancel"에 든다.
// 문구는 시스템 언어로 온다(ko 맥에서 "인증이 취소되었습니다."를 실측). 영어와 한국어를 읽고 모르는 언어는 `failed`다(인증을 주지 않는 쪽)
const CANCELLED_WORDS = ["cancel", "fallback", "취소"];
const DENIED_WORDS = [
  "authentication failed",
  "did not match",
  "denied",
  "인증하지 못",
  "일치하지 않",
];
const UNAVAILABLE_WORDS = [
  "not available",
  "not enrolled",
  "lockout",
  "passcode not set",
  "not interactive",
  "no biometr",
  "사용할 수 없",
  "등록되지 않",
  "잠겼",
];

/**
 * Electron `promptTouchID`가 거부한 값(보통 LAError 문구가 든 Error)을 종류로 바꾼다. 대소문자는 가리지 않는다.
 * 여기 없는 문구는 모두 `failed`다.
 */
export function classifyTouchIdError(error: unknown): ReauthKind {
  const message = messageOf(error).toLowerCase();
  if (includesAny(message, CANCELLED_WORDS)) return "cancelled";
  if (includesAny(message, DENIED_WORDS)) return "denied";
  if (includesAny(message, UNAVAILABLE_WORDS)) return "unavailable";
  return "failed";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/** 인자는 `{ reason: string }`이다. 모양이 다르면 null */
function reasonOf(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("reason" in args)) return null;
  return typeof args.reason === "string" ? args.reason : null;
}

/** 인증을 시도한다. 예상 가능한 실패는 값으로 돌려주고 던지지 않는다 */
async function evaluate(ports: OsReauthPorts, reason: string): Promise<Result<void, ReauthKind>> {
  // macOS가 아니면 Touch ID 창이 없다. 다른 OS의 인증은 후속이다(L0.secrets §4.9.1). 포트는 건드리지 않는다
  if (ports.platform !== "darwin") return err("unavailable");
  const capable = attempt(() => ports.canPromptTouchID());
  if (!capable.ok) return err("failed");
  if (!capable.value) return err("unavailable");
  const prompted = await attemptAsync(() => ports.promptTouchID(promptText(reason)));
  return prompted.ok ? ok(undefined) : err(classifyTouchIdError(prompted.error.cause));
}

/** 명령 핸들러. 인자가 틀리면 `bad-request`, 인증이 안 되면 `{ kind }`로 거절한다(명령 경계에서만 던진다) */
function osReauthHandler(ports: OsReauthPorts): CommandHandler {
  return async (_caller, args) => {
    const reason = reasonOf(args);
    if (reason === null) throw new ShellError("bad-request");
    const outcome = await evaluate(ports, reason);
    // 사유와 값은 로그에 쓰지 않는다. 결과 종류만 남긴다
    ports.log(`os reauth: ${outcome.ok ? "ok" : outcome.error}`);
    if (!outcome.ok) throw new ShellError({ kind: outcome.error });
    const grant: ReauthGrant = { verifiedAtMs: ports.now() };
    return grant;
  };
}

export function createOsReauthModule(ports: OsReauthPorts): ShellModule {
  return {
    name: "os-reauth",
    register(ctx: ShellContext) {
      ctx.handle("os_reauth", osReauthHandler(ports));
    },
  };
}
