import { existsSync } from "node:fs";
import { assertNever } from "@fresnel/contracts";
import type { SandboxProvider } from "./provider.ts";

// L0.sandbox.spec §4.9 "no-write" 프로필. 플러그인 호스트가 읽기 허용 목록 아래에서 뜨고 도는 데 꼭 필요한 시스템 경로.
// 추측하지 않고 실제 샌드박스에서 돌려 좁힌 목록이다(항목마다 이유를 단다). 사용자 홈, 다른 플러그인 폴더, 작업 폴더는 들어 있지 않다.
// 인증서 묶음과 DNS 설정은 들어 있지 않다: 호스트는 샌드박스 프록시를 거쳐 나가고(TLS 인증서는 Bun에 내장) 이름 풀이는 프록시가 한다.

/**
 * macOS(Seatbelt). 컴파일된 호스트 바이너리와 소스 실행 모두 이것만 더 읽는다.
 * - `/usr/share/icu`: Bun의 ICU 데이터(`Intl`). 없으면 소스 실행의 Bun이 시작 직후 죽는다(Trap)
 */
const DARWIN_PATHS: readonly string[] = ["/usr/share/icu"];

/**
 * Linux(bwrap). srt는 `/` 아래 최상위 폴더를 빈 tmpfs로 덮고 허용 항목만 다시 연다.
 * - `/bin/bash`: srt가 샌드박스 안에서 돌리는 셸
 * - `/lib`, `/lib64`, `/usr/lib`, `/usr/lib64`: 동적 링커와 공유 라이브러리(호스트 바이너리, bash, socat)
 * 프록시 소켓, seccomp 실행 파일 폴더, socat은 서비스가 더한다(srt 포트 `helperReadPaths`, 탐지한 socat 경로)
 */
const LINUX_PATHS: readonly string[] = ["/bin/bash", "/lib", "/lib64", "/usr/lib", "/usr/lib64"];

export function runtimeReadPaths(kind: SandboxProvider["kind"]): readonly string[] {
  switch (kind) {
    case "seatbelt":
      return DARWIN_PATHS.filter((path) => existsSync(path));
    case "bwrap":
      return LINUX_PATHS.filter((path) => existsSync(path));
    case "none":
      return [];
    default:
      return assertNever(kind, "SandboxProviderKind");
  }
}
