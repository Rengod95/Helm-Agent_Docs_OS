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
// 웹 검색 view-model(P-01 첫 실행, P-12 도구와 웹). 셸은 `.` 진입으로만 client를 쓰므로 여기서 다시 낸다(DR-10/desktop-client).
export {
  moveInOrder,
  orderUpdateOf,
  toolsWebViewOf,
  type OrderUpdate,
  type OrderUpdateError,
  type ToolsWebView,
  type WebRecommendation,
  type WebSection,
  type WebToolRow,
} from "./web/index.ts";
// 모델 계정과 레이트 리밋 view-model(P-11 계정과 제공자, 예산과 한도). 같은 이유로 `.`에서 다시 낸다.
// 설정 파일 원문 읽기와 쓰기(`settings.readFile`·`writeFile`)는 파일 편집기(P-09)가 쓴다. `saveModelAccounts`는 내지 않는다.
export {
  DEFAULT_RATE_LIMIT_POLICY,
  checkAccount,
  checkRateLimit,
  readAccounts,
  readRateLimit,
  readSettingsFile,
  withAccount,
  withRateLimit,
  withoutAccount,
  withoutRateLimit,
  writeSettingsFile,
  type AccountEntry,
  type RateLimitEntry,
  type SettingsFileError,
  type UsageLimitAction,
} from "./accounts/index.ts";
