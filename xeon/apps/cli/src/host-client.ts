// @xeon/host/client의 이름을 CLI 안에서 한 곳으로 모은다(L4.cli.spec §3.3). 엔진 패키지를 끌어오지 않는 가벼운 모듈이다.
// 허용 목록 항목 DR-10/cli-host가 이 진입점(./client)을 여는지는 [미결]이다: 이 파일 하나만 바꾸면 되도록 모아 둔다.
export {
  createHostConnection,
  HostClientError,
  type HostConnectionOptions,
} from "@xeon/host/client";
