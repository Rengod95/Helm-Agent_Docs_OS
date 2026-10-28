// L2.mcp.spec §4.8. 지수 백오프: 1초, 2초, 4초 … `maxDelayMs`까지. 난수를 쓰지 않아 시계를 주입한 시험이 같은 값을 본다.

const BASE_DELAY_MS = 1000;

/** `attempt`는 1부터. 첫 재시도가 1초다 */
export function backoffDelayMs(attempt: number, maxDelayMs: number): number {
  const exponent = Math.max(0, attempt - 1);
  // 2의 큰 거듭제곱이 Infinity가 되어도 min이 상한으로 낮춘다
  return Math.min(maxDelayMs, BASE_DELAY_MS * 2 ** exponent);
}
