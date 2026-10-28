import type { Shell } from "@xeon/contracts/services";

// L0.exec.spec §3.9. 무인 경로(예약, 루프)가 쓰는 명령 시간 상한이다(M3-REQ-46).
// 일반 대화의 l0.exec.defaultTimeoutMs는 0(제한 없음)을 유지하고, 무인 경로 호출자가 이 데코레이터로 상한을 건다.

/**
 * 각 `exec` 호출의 timeout(초)을 `capMs` 이하로 맞춘 Shell을 돌려준다.
 * 호출자가 더 짧은 timeout을 주면 그 값이 이기고, 없거나 더 길면 상한으로 바꾼다. 나머지 옵션은 건드리지 않는다.
 */
export function withUnattendedTimeout(shell: Shell, capMs: number): Shell {
  const capSec = capMs / 1000;
  return {
    exec: (command, options, context) => {
      const asked = options?.timeout;
      const timeout = asked === undefined || asked <= 0 || asked > capSec ? capSec : asked;
      return shell.exec(command, { ...options, timeout }, context);
    },
    cleanup: (context) => shell.cleanup(context),
  };
}
