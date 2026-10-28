import { err, ok, type Clock, type Result } from "@xeon/contracts";
import type { HumanReauth, OsPlatform } from "@xeon/contracts/services";
import type { ProcessRunner } from "./providers/process.ts";

// L0.secrets.spec §4.9.1 (M3-m2c-01). 사람의 OS 인증 재확인(Touch ID, 암호). 결과는 reveal이 받는 HumanReauth(`os-auth`)다.
// 서비스는 `os-auth` 증거의 시각만 검사한다(admin.ts). 이 파일은 그 증거를 만들어 내는 쪽이다.
// macOS 구현은 `osascript`의 관리자 권한 인증 대화상자를 쓴다. 실기 확인은 macOS 사용자 묶음이다.

export type OsAuthError =
  | { readonly kind: "unavailable" }
  /** 사람이 대화상자를 닫았다 */
  | { readonly kind: "cancelled" }
  /** 인증이 거절됐다(암호 틀림, 생체 인증 실패) */
  | { readonly kind: "denied" }
  | { readonly kind: "failed"; readonly code: string };

export interface OsAuthProvider {
  readonly id: "darwin-osascript";
  /** 이 환경에서 OS 인증을 요청할 수 있는가. reveal이 `tty-confirm`을 거부할지 가른다 */
  available(): boolean;
  /** 인증 대화상자를 띄운다. reason은 대화상자에 보이는 한 줄이고 값이 아니다. 성공하면 증거를 돌려준다 */
  verify(reason: string, signal: AbortSignal): Promise<Result<HumanReauth, OsAuthError>>;
}

const OSASCRIPT = "/usr/bin/osascript";
/** 사람이 대화상자 앞에 있는 시간을 넉넉히 준다 */
const TIMEOUT_MS = 120_000;
/** AppleScript가 사용자 취소에 내는 오류 번호 */
const CANCELLED = /-128|User canceled/i;
const MAX_PROMPT = 120;
const SPACE_RUN = /\s+/g;

/** 대화상자 문구에서 따옴표, 역슬래시, 제어 문자는 스크립트 문자열을 깨므로 공백으로 바꾸고 공백을 한 칸으로 줄인다 */
export function promptText(reason: string): string {
  let cleaned = "";
  for (const char of reason) {
    const code = char.codePointAt(0) ?? 0;
    cleaned += char === '"' || char === "\\" || code < 32 ? " " : char;
  }
  const text = cleaned.replaceAll(SPACE_RUN, " ").trim();
  return text === "" ? "Xeon" : text.slice(0, MAX_PROMPT);
}

interface DarwinOsAuthDeps {
  readonly runner: ProcessRunner;
  readonly clock: Pick<Clock, "now">;
  /** osascript 존재 확인. 기본 경로는 macOS에 항상 있다 */
  readonly pathExists: (path: string) => boolean;
  /** osascript 자식 env. 민감 변수를 거른 것이다 */
  readonly env: Readonly<Record<string, string>>;
}

function createDarwinOsAuth(deps: DarwinOsAuthDeps): OsAuthProvider {
  return {
    id: "darwin-osascript",
    available: () => deps.pathExists(OSASCRIPT),
    async verify(reason, signal) {
      if (!deps.pathExists(OSASCRIPT)) return err({ kind: "unavailable" });
      const script = `do shell script "true" with prompt "${promptText(reason)}" with administrator privileges`;
      const run = await deps.runner({
        argv: [OSASCRIPT, "-e", script],
        env: deps.env,
        timeoutMs: TIMEOUT_MS,
        signal,
        discardStdout: true,
      });
      if (!run.ok) {
        return err(
          run.error.kind === "cancelled"
            ? { kind: "cancelled" }
            : { kind: "failed", code: run.error.code },
        );
      }
      if (run.value.exitCode === 0) {
        // 시각은 인증이 끝난 지금이다. reveal이 60초 안인지 본다
        return ok({ method: "os-auth", verifiedAt: deps.clock.now() });
      }
      return err(CANCELLED.test(run.value.stderr) ? { kind: "cancelled" } : { kind: "denied" });
    },
  };
}

export interface OsAuthSelectInput extends DarwinOsAuthDeps {
  readonly platform: OsPlatform;
}

/** 플랫폼별 OS 인증. 지원하지 않는 플랫폼은 undefined이고 reveal은 `tty-confirm`만 받는다(Windows·Linux는 후속) */
export function selectOsAuth(input: OsAuthSelectInput): OsAuthProvider | undefined {
  return input.platform === "darwin" ? createDarwinOsAuth(input) : undefined;
}
