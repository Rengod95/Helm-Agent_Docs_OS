// HostConnection 구현의 이름을 CLI 안에서 한 곳으로 모은다(L4.cli.spec §3.3). 구현은 F `@xeon/contracts/wire`에 있어
// 엔진 패키지(@xeon/host)를 끌어오지 않는다.
export {
  createHostConnection,
  HostClientError,
  type HostConnectionOptions,
} from "@xeon/contracts/wire";
