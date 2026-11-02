import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";

// M4 포트 구현이 받는 의존. 계측 읽기와 Test run 제어는 계약의 포트 타입이라 소유 트랙이 ext-host를 기다리지 않는다.
// T-F 시점에는 빈 구현을 넘기고, T-XD의 마지막 커밋이 `index.ts`에서 ext-host 구현으로 바꾼다(`spec-deltas/t-f.md` §5 4번).

export interface M4PortDeps {
  readonly traceRead: TraceReadPort;
  readonly testRunControl: TestRunControlPort;
  /** 확장 버전과 화면 목록의 원천(T-XV, HS-108). 조립 루트가 넘긴다. 없으면 확장이 없는 것으로 본다 */
  readonly extUi?: ExtUiVersionSource | undefined;
}
