import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IsolationLaunch, IsolationLaunchInfo } from "@fresnel/ext-host";
import { currentSelf, selfEntryPrefix, type SelfRunTarget } from "../self-command.ts";

// L4.host-service.spec §4.9. 격리 확장의 플러그인 호스트 프로세스를 띄우는 명령과 환경. 엔진 실행 파일을 `plugin-host --stdio`로 다시 띄운다.
// 환경은 호스트가 정한 값(`FRESNEL_EXT_NAME`)만 싣는다(시크릿과 DB 경로를 넣지 않는다). 부모 환경은 포트(platform-process)가 정책에 따라 옮긴다:
// 열린 정책은 `FRESNEL_` 이름만 뺀 전부, 좁은 정책은 허용 목록이다 [결정: 2026-11-21, AGE-63].

/** 소스 실행이 읽는 작업 공간: 진입 파일에서 올라가며 처음 만나는 `bun.lock`이 있는 폴더. 못 찾으면 진입 파일 폴더만 읽는다 */
export function sourceWorkspaceOf(entry: string): string {
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
    // 소스 실행은 진입 파일이 가져오는 소스와 node_modules를 읽는다(좁은 정책에서만 쓰인다. 열린 정책은 읽기가 열려 있다). 컴파일 바이너리는 실행 파일 하나라 더 읽지 않는다
    ...(prefix.length === 0 ? {} : { runtimeReadRoots: [sourceWorkspaceOf(self.entry)] }),
  };
}
