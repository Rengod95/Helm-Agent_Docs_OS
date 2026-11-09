import type { HostMode } from "../types.ts";

// L4.host-service.spec HS-40·HS-83. 이 프로세스가 예약 틱을 돌려 보는 모드인가.
// 서비스와 stdio(데스크톱 사이드카)는 틱을 시도하고, 하나만 도는 것은 `sys_leases`의 `scheduler` 임대가 보장한다.
// 서비스가 떠 있으면 데스크톱은 사이드카 대신 서비스에 붙으므로 사이드카가 저장소를 같이 여는 일이 없다.
// 설정 `l0.process.service.enabled`는 보지 않는다: 설정이 켜져 있어도 서비스를 띄우지 못해 사이드카가 남은 경우 예약이 멈추면 안 된다.
export function ticksInThisProcess(mode: HostMode): boolean {
  return mode === "service" || mode === "stdio";
}
