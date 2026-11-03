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
