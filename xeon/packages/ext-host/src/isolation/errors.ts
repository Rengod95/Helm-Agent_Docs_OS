// 플러그인 프로세스가 끝나서 실패한 호출의 오류(isolation-protocol.ts의 PLUGIN_PROCESS_FAILURE_REASONS).
// 대리 핸들러(part 2)가 이 오류를 던지면 디스패처가 `reason`을 실패 이유로 쓴다(primitives/dispatch.ts).
import type { PluginProcessFailureReason } from "@fresnel/contracts/extensions";

/** 프로세스가 스스로 끝났거나(`process_exit`) 엔진이 시간 초과로 멈춘(`process_killed`) 호출이 낸 오류 */
export class PluginProcessError extends Error {
  override readonly name: string = "PluginProcessError";
  readonly reason: PluginProcessFailureReason;

  constructor(reason: PluginProcessFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** 값이 플러그인 프로세스 오류인가. 실패 이유를 읽기 전에 쓴다 */
export function isPluginProcessError(value: unknown): value is PluginProcessError {
  return value instanceof PluginProcessError;
}
