import {
  bashShellConfig,
  killPosixProcessTree,
  POSIX_FALLBACK_SHELL,
  type ExecPlatformProvider,
} from "../provider.ts";

/** Linux: 디렉터리마다 watcher를 두고 statfs로 신뢰도 낮은 파일 시스템을 가린다. WSL은 `wsl` 표시만 다르다 */
export function createLinuxProvider(options: { readonly wsl: boolean }): ExecPlatformProvider {
  return {
    platform: { kind: "linux", wsl: options.wsl },
    backslashTilde: false,
    shellCandidates: () => ["/bin/bash"],
    bashLookup: ["which", "bash"],
    fallbackShell: POSIX_FALLBACK_SHELL,
    bashConfig: bashShellConfig,
    killProcessTree: killPosixProcessTree,
    detachedSpawn: true,
    noFollow: "open_flag",
    forcePollingWatch: false,
    statfsUnreliableCheck: true,
    perDirectoryWatchers: true,
    fsEventsSettleRescan: false,
    envAllowlistExtra: [],
  };
}
