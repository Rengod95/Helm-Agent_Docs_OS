import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IsolationLaunch, IsolationLaunchInfo } from "@fresnel/ext-host";
import { currentSelf, selfEntryPrefix, type SelfRunTarget } from "../self-command.ts";

// L4.host-service.spec §4.9. 격리 확장의 플러그인 호스트 프로세스를 띄우는 명령과 환경. 엔진 실행 파일을 `plugin-host --stdio`로 다시 띄운다.
// 환경은 허용 목록으로만 만든다(시크릿과 DB 경로를 넣지 않는다). 부모 환경의 허용 목록 이름은 포트(platform-process)가 더한다.

/** 소스 실행이 읽는 작업 공간: 진입 파일에서 올라가며 처음 만나는 `bun.lock`이 있는 폴더. 못 찾으면 진입 파일 폴더만 읽는다 */
function sourceWorkspaceOf(entry: string): string {
  let dir = dirname(entry);
  for (;;) {
    if (existsSync(join(dir, "bun.lock"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dirname(entry);
    dir = parent;
  }
}

/**
 * 확장 하나의 플러그인 호스트 명령. `self`는 시험이 넣는다(기본은 이 실행 파일).
 * 소스 실행의 명령줄은 `bun <main.ts> plugin-host --stdio`, 컴파일 바이너리는 `<바이너리> plugin-host --stdio`다.
 */
export function pluginHostLaunch(
  info: IsolationLaunchInfo,
  self: SelfRunTarget = currentSelf(),
): IsolationLaunch {
  const prefix = selfEntryPrefix(self);
  return {
    command: self.execPath,
    args: [...prefix, "plugin-host", "--stdio"],
    env: { FRESNEL_EXT_NAME: info.name },
    // 소스 실행은 진입 파일이 가져오는 소스와 node_modules를 읽는다. 컴파일 바이너리는 실행 파일 하나라 더 읽지 않는다
    ...(prefix.length === 0 ? {} : { runtimeReadRoots: [sourceWorkspaceOf(self.entry)] }),
  };
}
