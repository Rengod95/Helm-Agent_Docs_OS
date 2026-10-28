// L0.exec.spec §3.8.1의 `withUnattendedTimeout` 규칙을 여기서 같게 구현한다. platform-exec는 devDependency라 src에서 import하지 않는다.

/**
 * 무인 호출(`CallContext.interactive === false`)의 제한 시간(초)을 정한다.
 * 요청이 없거나 0 이하이거나 상한보다 길면 상한이다. 상한보다 짧은 요청은 그대로 둔다.
 * 상한이 없으면(`capMs`가 undefined) 요청을 그대로 돌려준다.
 */
export function unattendedTimeoutSec(
  requestedSec: number | undefined,
  capMs: number | undefined,
): number | undefined {
  if (capMs === undefined) return requestedSec;
  const capSec = capMs / 1000;
  return requestedSec === undefined || requestedSec <= 0 || requestedSec > capSec
    ? capSec
    : requestedSec;
}
