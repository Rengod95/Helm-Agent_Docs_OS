import type { IsolationLaunch, IsolationLaunchInfo } from "@fresnel/ext-host";
import { currentSelf, selfEntryPrefix, type SelfRunTarget } from "../self-command.ts";

// L4.host-service.spec §4.9. 격리 확장의 플러그인 호스트 프로세스를 띄우는 명령과 환경. 엔진 실행 파일을 `plugin-host --stdio`로 다시 띄운다.
// 환경은 허용 목록으로만 만든다(시크릿과 DB 경로를 넣지 않는다). 부모 환경의 허용 목록 이름은 포트(platform-process)가 더한다.

/**
 * 확장 하나의 플러그인 호스트 명령. `self`는 시험이 넣는다(기본은 이 실행 파일).
 * 소스 실행의 명령줄은 `bun <main.ts> plugin-host --stdio`, 컴파일 바이너리는 `<바이너리> plugin-host --stdio`다.
 */
export function pluginHostLaunch(
  info: IsolationLaunchInfo,
  self: SelfRunTarget = currentSelf(),
): IsolationLaunch {
  return {
    command: self.execPath,
    args: [...selfEntryPrefix(self), "plugin-host", "--stdio"],
    env: { FRESNEL_EXT_NAME: info.name },
  };
}
