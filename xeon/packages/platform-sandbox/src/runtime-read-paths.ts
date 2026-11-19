import { existsSync, readlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
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

/**
 * 스크립트 실행기만 더하는 시스템 도구 읽기·실행 경로(L0.sandbox.spec §4.9, [결정: 2026-11-19, 사용자, AGE-58 "다 열어"]).
 * 쓰기는 하나도 더하지 않는다. 사용자 홈, `/etc`, `/Library`, `/private/var`, `/usr` 전체는 열지 않는다. 항목마다 이유를 단다.
 */
const DARWIN_TOOL_PATHS: readonly string[] = [
  "/bin",
  "/usr/bin",
  // `/usr/bin/git` 같은 개발자 도구 껍데기(xcode-select shim)가 어느 개발자 폴더의 도구를 부를지 읽는 선택 링크(`developer_dir`)와 셸 링크(`sh`)다.
  // 이 폴더에는 링크 둘뿐이다. 읽지 못하면 shim이 `xcode-select: error: unable to read data link`로 끝난다
  "/private/var/select",
  // `curl`(LibreSSL)이 시작할 때 읽는 OpenSSL 설정(`openssl.cnf`)과 CA 묶음. 없으면 `Auto configuration failed ... Operation not permitted`로 끝난다.
  // `/etc` 전체가 아니라 `ssl` 폴더 하나다(공개 인증서와 설정뿐)
  "/private/etc/ssl",
  // 개발자 도구 껍데기(xcrun)와 `sw_vers`가 호스트 OS 버전을 읽는 시스템 파일. 없으면 `unable to determine the version of the host OS`로 끝난다
  "/System/Library/CoreServices/SystemVersion.plist",
];

/**
 * 이름 하나만 읽게 하는 경로. `/var`는 `/private/var`로 가는 심볼릭 링크라서 `/var/select/developer_dir`을 읽는 도구(`xcode-select` shim)가
 * 링크 자체를 읽는다. 하위 경로까지 열면 `/private/var`가 통째로 열리므로(시험으로 확인) 링크 이름만 literal로 연다
 */
const DARWIN_TOOL_LITERALS: readonly string[] = ["/var", "/etc", "/private/etc/gitconfig"];

/**
 * 시스템 도구 폴더를 열어도 다시 막는 실행 파일(개별 도구 차단, [결정: 2026-11-19, 사용자, AGE-58]의 조건: 클립보드, 화면 캡처, 키체인, 다른 앱 조작,
 * 다른 프로세스의 인자 보기, 샌드박스 밖 실행이 열리면 그 도구를 막는다). 시험(`script-boundary.int.test.ts`)이 도구마다 막힘을 확인한다.
 * - `launchctl`: 사용자 launchd 도메인과 통신한다(서비스 목록 읽기, 샌드박스 밖에서 도는 작업 등록 가능성)
 * - `open`: LaunchServices로 앱을 띄우거나 URL을 연다(샌드박스 밖 앱이 스크립트 파일을 실행하게 할 수 있다)
 * - `osascript`, `osacompile`: AppleScript로 다른 앱을 조작한다
 * - `security`: 키체인 도구
 * - `pbcopy`, `pbpaste`: 클립보드
 * - `screencapture`: 화면 캡처
 * - `defaults`: 사용자 환경설정 읽기·쓰기
 * - `mdfind`, `mdls`: Spotlight(폴더 밖 파일 이름과 메타데이터)
 * - `log`: 통합 로그
 * - `lsof`: 같은 사용자의 다른 프로세스가 연 파일과 작업 폴더(시험에서 막히지 않음을 확인했다)
 * - `ps`, `top`, `sudo`, `su`: 프로세스 목록과 권한 상승(이미 실행이 막히지만 목록에서 빼지 않는다)
 */
const DARWIN_TOOL_DENY: readonly string[] = [
  "/bin/launchctl",
  "/bin/ps",
  "/usr/bin/open",
  "/usr/bin/osascript",
  "/usr/bin/osacompile",
  "/usr/bin/security",
  "/usr/bin/pbcopy",
  "/usr/bin/pbpaste",
  "/usr/sbin/screencapture",
  "/usr/bin/defaults",
  "/usr/bin/mdfind",
  "/usr/bin/mdls",
  "/usr/bin/log",
  "/usr/bin/top",
  "/usr/sbin/lsof",
  "/usr/bin/sudo",
  "/usr/bin/su",
];

/** Linux: `/bin`과 `/usr/bin`의 도구가 돌 라이브러리는 `LINUX_PATHS`(`/lib*`, `/usr/lib*`)가 이미 연다 */
const LINUX_TOOL_PATHS: readonly string[] = ["/bin", "/usr/bin"];

/**
 * 개발자 도구 폴더의 `usr`(실제 `git`과 그 라이브러리, 읽기·실행만). 선택 링크가 가리키는 폴더를 지금 읽어 정한다
 * (Command Line Tools면 `/Library/Developer/CommandLineTools`, Xcode면 `<Xcode>/Contents/Developer`). 링크가 없거나 이상하면 더하지 않는다
 */
function developerDirOf(): string | undefined {
  const link = "/private/var/select/developer_dir";
  if (!existsSync(link)) return undefined;
  const target = readlinkSync(link);
  return isAbsolute(target) ? target : undefined;
}

function developerToolsUsr(): readonly string[] {
  const dir = developerDirOf();
  if (dir === undefined) return [];
  return [join(dir, "usr"), join(dir, "SDKs")].filter((path) => existsSync(path));
}

/**
 * 기본 프로필(srt)이 열어 둔 Mach 서비스 가운데 스크립트 실행기에서는 다시 막는 것(도구를 거치지 않는 호출도 막는다).
 * - `com.apple.SecurityServer`, `com.apple.securityd.xpc`: 키체인 데몬. 열려 있으면 `security` 없이도(Security 프레임워크를 부르는 스크립트) 키체인 질의가 닿는다
 * - `com.apple.coreservices.launchservicesd`: LaunchServices. 열려 있으면 앱을 띄우거나 URL을 열 수 있다
 * 시험이 막힘과 런타임(bash, bun)이 그대로 도는 것을 같이 확인한다
 */
const DARWIN_MACH_DENY: readonly string[] = [
  "com.apple.SecurityServer",
  "com.apple.securityd.xpc",
  "com.apple.coreservices.launchservicesd",
];

export function systemToolMachDeny(kind: SandboxProvider["kind"]): readonly string[] {
  return kind === "seatbelt" ? DARWIN_MACH_DENY : [];
}

/** 시스템 도구 폴더 안에서 다시 막는 실행 파일(있는 것만). Seatbelt만 프로필 끝에서 적용한다. bwrap은 아직 같은 뜻의 막기가 없다(Linux 확인 못 함) */
export function systemToolDeny(kind: SandboxProvider["kind"]): readonly string[] {
  return kind === "seatbelt" ? DARWIN_TOOL_DENY.filter((path) => existsSync(path)) : [];
}

/** 이름 하나만 읽게 하는 경로(Seatbelt) */
export function systemToolLiterals(kind: SandboxProvider["kind"]): readonly string[] {
  if (kind !== "seatbelt") return [];
  // 개발자 도구 껍데기는 선택한 개발자 폴더 자체도 열어 보므로(`developer directory ... is not accessible`) 그 폴더 이름 하나(하위 경로 없이)를 더한다
  const dir = developerDirOf();
  return [...DARWIN_TOOL_LITERALS, ...(dir === undefined ? [] : [dir])];
}

export function systemToolReadPaths(kind: SandboxProvider["kind"]): readonly string[] {
  switch (kind) {
    case "seatbelt":
      return [...DARWIN_TOOL_PATHS, ...developerToolsUsr()].filter((path) => existsSync(path));
    case "bwrap":
      return LINUX_TOOL_PATHS.filter((path) => existsSync(path));
    case "none":
      return [];
    default:
      return assertNever(kind, "SandboxProviderKind");
  }
}
