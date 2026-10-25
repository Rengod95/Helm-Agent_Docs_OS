import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LoopService } from "@xeon/contracts/services";
import { requestKeyFor } from "@xeon/contracts/records";
import { sha256Hex } from "../hash.ts";

/**
 * 사용자 개시 셸 실행 포트(L2.dialog.spec §4.2.4 6번). 기본 구현은 `shellPortOver`로, `xeon.loop`의 `runUserBash`를 부른다.
 * loop가 `user_bash` 지점을 발화한 뒤 L1.tools의 `runUserShell`(정책은 caller `main` 대화형)로 실행하므로
 * 일반 도구 권한과 샌드박스 규칙이 그대로 적용된다.
 */
export interface ShellRunContext {
  readonly threadId: ThreadId;
  /** 명령 입력의 멱등 키 */
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface ShellOutput {
  readonly output: string;
}

/**
 * - denied: 정책이나 `tool_call` 지점이 막았다
 * - failed: 실행했으나 실패했다(0 아닌 종료 코드, 시간 초과 등). `code`는 종료 코드나 오류 코드다
 */
export type ShellFailure =
  | { readonly kind: "denied"; readonly message: string }
  | { readonly kind: "failed"; readonly code: string; readonly message: string };

export interface ShellPort {
  run(command: string, context: ShellRunContext): Promise<Result<ShellOutput, ShellFailure>>;
}

const LOOP_REQUEST_ID_MAX = 64;

/**
 * `xeon.loop`의 `runUserBash`를 셸 포트로 감싼다. 이 경로는 turn을 열지 않으므로 명령 확장 중에도 부를 수 있고, 정책(caller `main`, 대화형)과
 * `user_bash` 지점은 loop가 L1.tools의 `runUserShell`로 이어 적용한다. 명령 출력은 템플릿에 치환되어 입력으로 가므로 결과를 따로
 * 모델 컨텍스트에 넣지 않는다(`excludeFromContext: true`). 규칙:
 * - `denied`는 포트의 `denied`다.
 * - 종료 코드가 0이 아니거나 중단된 실행은 `failed`다. `code`는 종료 코드나 `cancelled`다.
 * - 실행 전의 실패(`LoopError`)는 `failed`이고 `code`가 오류 종류다.
 * - 호출 키(`<requestId>:sh<순번>`)가 loop의 한도(64자)를 넘으면 F `requestKeyFor`(`h_` + sha256 앞 40자)로 줄인다.
 */
export function shellPortOver(loop: Pick<LoopService, "runUserBash">): ShellPort {
  return {
    async run(command, context) {
      const requestId =
        context.requestId.length <= LOOP_REQUEST_ID_MAX
          ? context.requestId
          : requestKeyFor(context.requestId, sha256Hex);
      const outcome = await loop.runUserBash({
        threadId: context.threadId,
        command,
        excludeFromContext: true,
        requestId,
        signal: context.signal,
      });
      if (!outcome.ok) {
        return err({
          kind: "failed",
          code: outcome.error.kind,
          message: `The loop could not run the command (${outcome.error.kind}).`,
        });
      }
      const { value } = outcome;
      if (value.status === "denied") return err({ kind: "denied", message: value.reason });
      const { result } = value;
      if (result.cancelled) {
        return err({ kind: "failed", code: "cancelled", message: "The command was cancelled." });
      }
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        return err({
          kind: "failed",
          code: String(result.exitCode),
          message: `The command exited with code ${result.exitCode}.`,
        });
      }
      return ok({ output: result.output });
    },
  };
}
