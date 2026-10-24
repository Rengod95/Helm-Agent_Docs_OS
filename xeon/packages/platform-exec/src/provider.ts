// L0.exec.spec §3.4. OS 분기 인터페이스. 소비자와 포크 코드는 OS를 직접 묻지 않고 이 값만 묻는다(eng.dependency-rules.guide DR-13).

import { attempt } from "@xeon/contracts";

export interface ShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  /** 구형 WSL bash.exe는 명령을 stdin으로 받는다(-s) */
  readonly commandTransport?: "argv" | "stdin";
}

export type ExecPlatform =
  | { readonly kind: "darwin" }
  | { readonly kind: "linux"; readonly wsl: boolean }
  | { readonly kind: "win32" };

export interface ExecPlatformProvider {
  readonly platform: ExecPlatform;
  /** "~\\"를 홈 기준 경로로 읽는가 */
  readonly backslashTilde: boolean;
  /** 고정 후보 경로. darwin·linux ["/bin/bash"], win32 Git Bash 후보 */
  shellCandidates(): readonly string[];
  /** PATH에서 bash를 찾는 명령. ["which", "bash"] | ["where", "bash.exe"] */
  readonly bashLookup: readonly [string, ...string[]];
  /** bash가 없을 때 쓰는 셸. POSIX {sh -c}, win32 없음(shell_unavailable) */
  readonly fallbackShell: ShellConfig | undefined;
  /** 경로에 맞는 bash 인자(구형 WSL bash.exe 판정 포함) */
  bashConfig(path: string): ShellConfig;
  /** 프로세스 트리 종료. POSIX kill(-pid, SIGKILL) 후 kill(pid), win32 taskkill /F /T */
  killProcessTree(pid: number): void;
  /** 프로세스 트리에 정중한 종료 요청(startBackground의 graceful). POSIX kill(-pid, SIGTERM) 후 kill(pid), win32 taskkill /T (강제 아님) */
  terminateProcessTree(pid: number): void;
  /** spawn detached 값. POSIX true(새 프로세스 그룹), win32 false */
  readonly detachedSpawn: boolean;
  /** noFollow 구현. POSIX "open_flag"(O_NOFOLLOW), win32 "lstat_precheck"(경합 가능) */
  readonly noFollow: "open_flag" | "lstat_precheck";
  /** 기본 감시 방식을 polling으로 강제하는가(win32) */
  readonly forcePollingWatch: boolean;
  /** statfs magic으로 감시 신뢰도가 낮은 파일 시스템을 판정하는가(linux) */
  readonly statfsUnreliableCheck: boolean;
  /** 디렉터리마다 native watcher를 두는가(linux). 아니면 대상마다 recursive 하나 */
  readonly perDirectoryWatchers: boolean;
  /** 감시 설치 뒤 FSEvents 지연 보정 재스캔을 하는가(darwin, 500 ms) */
  readonly fsEventsSettleRescan: boolean;
  /** 자식 env 허용 목록에 OS가 더하는 이름(3.5절). win32: SystemRoot, ComSpec, PATHEXT, USERPROFILE, TEMP, TMP */
  readonly envAllowlistExtra: readonly string[];
}

/** `C:\Windows\System32\bash.exe`, `...\Sysnative\bash.exe`는 구형 WSL 진입점이라 명령을 stdin으로 받는다 */
function isLegacyWslBashPath(path: string): boolean {
  const normalized = path.replace(/\//g, "\\").toLowerCase();
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}

/** 세 provider가 같은 규칙을 쓴다(원본 getBashShellConfig와 같은 동작) */
export function bashShellConfig(shell: string): ShellConfig {
  return isLegacyWslBashPath(shell)
    ? { shell, args: ["-s"], commandTransport: "stdin" }
    : { shell, args: ["-c"] };
}

/** POSIX 공통: 프로세스 그룹에 SIGKILL, 안 되면 그 프로세스에만 */
export function killPosixProcessTree(pid: number): void {
  const group = attempt(() => process.kill(-pid, "SIGKILL"));
  if (group.ok) return;
  // 프로세스 그룹이 없으면 그 프로세스에만 보낸다. 이것도 실패하면 이미 끝난 프로세스다
  attempt(() => process.kill(pid, "SIGKILL"));
}

/** POSIX 공통: 프로세스 그룹에 SIGTERM, 안 되면 그 프로세스에만 */
export function terminatePosixProcessTree(pid: number): void {
  const group = attempt(() => process.kill(-pid, "SIGTERM"));
  if (group.ok) return;
  attempt(() => process.kill(pid, "SIGTERM"));
}

export const POSIX_FALLBACK_SHELL: ShellConfig = { shell: "sh", args: ["-c"] };
