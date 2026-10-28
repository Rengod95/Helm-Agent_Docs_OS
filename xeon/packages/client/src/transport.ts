// ADR-0020 §3.3. 클라이언트가 연결에 꽂는 전송의 자리다. `Transport`는 F `F.wire-settings.spec` §3.1의 인터페이스 그대로이고
// Node API를 쓰지 않는다(메시지 하나를 보내고 받고 닫는 계약뿐이다). 소켓 전송(M3b)과 브라우저 전송(M4)은 이 인터페이스를 구현해
// `createHostConnection(transport)`에 넘긴다. Node 모듈이 필요한 전송 구현은 별도 export 경로에 둔다.
export type {
  CloseInfo,
  HostConnection,
  StdioTransportFactory,
  StdioTransportOptions,
  Transport,
  TransportKind,
  Unsubscribe,
  WireRequestOptions,
} from "@xeon/contracts/wire";
