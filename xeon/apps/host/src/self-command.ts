import { basename } from "node:path";

// 이 실행 파일이 자기 자신을 다른 하위 명령으로 다시 띄우는 규칙. 서비스 재기동(`service run`)과 플러그인 호스트(`plugin-host --stdio`)가 같이 쓴다.
// 소스 실행(bun이 진입 파일을 직접 읽음)이면 진입 파일 경로가 인자 앞에 붙고, 컴파일 바이너리면 실행 파일만 쓴다(L4.host-service.spec §3.2).

/** 자기 실행의 두 값. 테스트는 값을 직접 넣고, 운영은 `currentSelf()`를 쓴다 */
export interface SelfRunTarget {
  /** `process.execPath`: bun 또는 컴파일 바이너리 */
  readonly execPath: string;
  /** `Bun.main`: 소스 실행이면 진입 파일, 컴파일 바이너리면 `/$bunfs/` 아래 경로 */
  readonly entry: string;
}

export function currentSelf(): SelfRunTarget {
  return { execPath: process.execPath, entry: Bun.main };
}

/** 실행 파일 앞에 붙는 인자. 소스 실행이면 `[진입 파일]`, 컴파일 바이너리면 `[]`다 */
export function selfEntryPrefix(self: SelfRunTarget): readonly string[] {
  const isScript = /\.(ts|js|mjs)$/.test(self.entry) && !self.entry.startsWith("/$bunfs/");
  return isScript && basename(self.execPath) !== basename(self.entry) ? [self.entry] : [];
}
