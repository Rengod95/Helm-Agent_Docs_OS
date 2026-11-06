// `os_reauth` 명령(L4.desktop.spec §4.17)의 순수 로직. Rust `os_reauth.rs`의 사유 문구, 오류 분류, 결과 로그를 옮긴다.
// 이 파일은 electron을 import하지 않는다. 실제 Touch ID 호출과 시계, 로그는 os-reauth-shell.ts가 ports로 넘긴다.
//
// 인증은 `mac-security` 애드온(LAPolicyDeviceOwnerAuthentication)이 한다: Touch ID가 안 되면 Mac 암호 창으로 넘어간다 [결정: 2026-11-06 사용자].
// 거절 사유는 애드온의 `MacSecurityError.kind`를 그대로 읽는다(문구 분류는 없다).

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
  /** 인증 창을 띄울 수 있는지(`canAuthenticate().available`). macOS에서만 부른다 */
  canAuthenticate(): boolean;
  /** 인증 창을 띄운다. 인증되면 이행하고, 거절이나 취소는 `kind`가 있는 오류로 거부한다 */
  authenticate(reason: string): Promise<void>;
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

/**
 * 애드온이 거부한 값(`MacSecurityError`)의 `kind`를 읽는다. 다른 사본의 오류도 모양으로 받는다.
 * `kind`가 없거나 모르는 값이면 `failed`다(인증을 주지 않는 쪽).
 */
export function reauthKindOf(error: unknown): ReauthKind {
  if (typeof error !== "object" || error === null || !("kind" in error)) return "failed";
  const kind = error.kind;
  if (kind === "cancelled" || kind === "denied" || kind === "unavailable") return kind;
  return "failed";
}

/** 인자는 `{ reason: string }`이다. 모양이 다르면 null */
function reasonOf(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("reason" in args)) return null;
  return typeof args.reason === "string" ? args.reason : null;
}

/** 인증을 시도한다. 예상 가능한 실패는 값으로 돌려주고 던지지 않는다 */
async function evaluate(ports: OsReauthPorts, reason: string): Promise<Result<void, ReauthKind>> {
  // macOS가 아니면 인증 창이 없다. 다른 OS의 인증은 후속이다(L0.secrets §4.9.1). 포트는 건드리지 않는다
  if (ports.platform !== "darwin") return err("unavailable");
  const capable = attempt(() => ports.canAuthenticate());
  if (!capable.ok) return err("failed");
  if (!capable.value) return err("unavailable");
  const prompted = await attemptAsync(() => ports.authenticate(promptText(reason)));
  return prompted.ok ? ok(undefined) : err(reauthKindOf(prompted.error.cause));
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
