// HostConnection 구현의 이름을 CLI 안에서 한 곳으로 모은다(L4.cli.spec §3.3). 구현은 L4 공유 패키지 `@xeon/client`에 있어
// 엔진 패키지(@xeon/host)를 끌어오지 않는다(adr.0020).
export { createHostConnection, HostClientError, type HostConnectionOptions } from "@xeon/client";
