// L4.host-service.spec §3.3.4 "client.ts". HostConnection 구현은 F `@xeon/contracts/wire`로 옮겼다(런타임 중립, CLI·데스크톱과 공유).
// 이 파일은 호스트 패키지의 기존 import 경로(`@xeon/host/client`)를 지키는 재노출이다. 엔진 패키지를 import하지 않는다
// (L4.host-service.plan §2, test/client-boundary.test.ts). connectServiceTransport(socket)는 서비스 모드(M3)라 아직 없다.
export {
  createHostConnection,
  HostClientError,
  type HostClientErrorKind,
  type HostConnectionOptions,
} from "@xeon/contracts/wire";
