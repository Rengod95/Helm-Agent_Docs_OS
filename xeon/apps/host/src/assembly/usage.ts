import type { UsagePort } from "../types.ts";

// M3-REQ-15. 사용량 게이지 원천의 조립 기본이다. 레이트 리밋과 계정 풀 게이지는 B2-MDL 트랙이 원천을 채울 때까지 없으므로 빈 목록을 돌려준다.
// 원천을 바꿔 끼우는 자리는 `EnginePorts.usage`다. 조립 루트 코드(DR-14 예외 2).

/** 게이지가 없는 원천. `usage.get`은 빈 `gauges`와 `asOf`를 돌려준다 */
export function emptyUsageSource(): UsagePort {
  return { gauges: () => Promise.resolve([]) };
}
