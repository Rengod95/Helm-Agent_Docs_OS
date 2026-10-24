import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";

/**
 * 사용자 개시 셸 실행 포트(L2.dialog.spec §4.2.4 6번). 실제 구현은 L1.tools의 `runUserShell`
 * (`ToolService.runUserShell`, 정책은 caller `main` 대화형)을 감싼다. `runUserShell`이 `ToolRunContext`를 요구하므로
 * 어댑터는 HOST 조립이 만든다. 일반 도구 권한과 샌드박스 규칙이 그대로 적용된다.
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
