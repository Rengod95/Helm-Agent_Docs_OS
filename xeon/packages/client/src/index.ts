export {
  createHostConnection,
  HostClientError,
  type HostClientErrorKind,
  type HostConnectionOptions,
} from "./connection.ts";
export type {
  CloseInfo,
  HostConnection,
  StdioTransportFactory,
  StdioTransportOptions,
  Transport,
  TransportKind,
  Unsubscribe,
  WireRequestOptions,
} from "./transport.ts";
// 예약 view-model(P-07, O-08). 앱은 `.` 진입으로만 client를 쓴다(scripts/dependency-allowlist.json DR-10/desktop-client),
// 그래서 `./schedule` 진입 대신 여기서 다시 낸다. 순수 함수만 있다.
export * from "./schedule/index.ts";
// 연결 대상 view-model(P-08). 셸 쪽은 `.` 진입으로만 client를 쓰므로(위 예약과 같은 이유) 여기서 다시 낸다. 순수 함수와 키 상수만 있다.
export * from "./connection-targets/index.ts";
// 웹 검색 권장 view-model(P-01 첫 실행). 셸은 `.` 진입으로만 client를 쓰므로 여기서 세 이름만 다시 낸다(DR-10/desktop-client).
export { toolsWebViewOf, type ToolsWebView, type WebRecommendation } from "./web/index.ts";
