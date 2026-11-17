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

/**
 * 단계 함수가 돌려준 명령이 `DriveCommand` 모양이 아니다. 프로세스는 살아 있다. 일반 단계 오류로 본다: 엔진은 그 프레임을 내리고
 * 주도 등록을 오류로 표시한다(drive-isolation.md 2.4). `kind`는 `invalid_command`다
 */
export class DriveCommandError extends Error {
  override readonly name: string = "DriveCommandError";
  readonly kind = "invalid_command";
}
