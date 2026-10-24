import { spawn } from "node:child_process";
import { win32 as winPath } from "node:path";
import { attempt, type Logger } from "@xeon/contracts";
import { bashShellConfig, type ExecPlatformProvider } from "../provider.ts";

export interface Win32ProviderDeps {
  /** ProgramFiles, "ProgramFiles(x86)", SystemRoot를 읽는다 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 인자 목록(argv[0]은 프로그램)을 실행한다. 기다리지 않는다. 시험은 이 함수를 대신 넣는다 */
  readonly run?: (argv: readonly string[]) => void;
  /** 프로세스 종료 호출(taskkill)을 띄우지 못했을 때 기록한다. 없으면 기록하지 않는다 */
  readonly logger?: Logger;
}

function spawnDetached(argv: readonly string[], logger: Logger | undefined): void {
  const [program, ...args] = argv;
  if (program === undefined) return;
  const started = attempt(() =>
    spawn(program, args, { stdio: "ignore", detached: true, windowsHide: true }),
  );
  if (!started.ok) {
    logger?.warn("exec.kill_tree_spawn_failed", { program, cause: describe(started.error.cause) });
    return;
  }
  // spawn 실패는 "error"로 비동기에 알려진다. 처리하지 않으면 프로세스가 죽으므로 기록하고 끝낸다
  started.value.once("error", (cause: unknown) => {
    logger?.warn("exec.kill_tree_spawn_failed", { program, cause: describe(cause) });
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Windows 네이티브. 1차는 원본 동작을 그대로 옮긴 것이고 단위 시험만 있다(L0.exec.plan R-6, EX-17은 M2 이후).
 */
export function createWin32Provider(deps: Win32ProviderDeps): ExecPlatformProvider {
  const run = deps.run ?? ((argv: readonly string[]): void => spawnDetached(argv, deps.logger));
  return {
    platform: { kind: "win32" },
    backslashTilde: true,
    shellCandidates: () => {
      const candidates: string[] = [];
      const programFiles = deps.env["ProgramFiles"];
      if (programFiles) candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
      const programFilesX86 = deps.env["ProgramFiles(x86)"];
      if (programFilesX86) candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
      return candidates;
    },
    bashLookup: ["where", "bash.exe"],
    fallbackShell: undefined,
    bashConfig: bashShellConfig,
    killProcessTree: (pid) => {
      run([
        winPath.join(deps.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"),
        "/F",
        "/T",
        "/PID",
        String(pid),
      ]);
    },
    terminateProcessTree: (pid) => {
      run([
        winPath.join(deps.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"),
        "/T",
        "/PID",
        String(pid),
      ]);
    },
    detachedSpawn: false,
    noFollow: "lstat_precheck",
    forcePollingWatch: true,
    statfsUnreliableCheck: false,
    perDirectoryWatchers: false,
    fsEventsSettleRescan: false,
    envAllowlistExtra: ["SystemRoot", "ComSpec", "PATHEXT", "USERPROFILE", "TEMP", "TMP"],
  };
}
