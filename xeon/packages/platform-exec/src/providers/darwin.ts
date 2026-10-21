import {
  bashShellConfig,
  killPosixProcessTree,
  POSIX_FALLBACK_SHELL,
  type ExecPlatformProvider,
} from "../provider.ts";

/** macOS: FSEvents가 설치 직후 변경을 놓치므로 재스캔한다 */
export const darwinProvider: ExecPlatformProvider = {
  platform: { kind: "darwin" },
  backslashTilde: false,
  shellCandidates: () => ["/bin/bash"],
  bashLookup: ["which", "bash"],
  fallbackShell: POSIX_FALLBACK_SHELL,
  bashConfig: bashShellConfig,
  killProcessTree: killPosixProcessTree,
  detachedSpawn: true,
  noFollow: "open_flag",
  forcePollingWatch: false,
  statfsUnreliableCheck: false,
  perDirectoryWatchers: false,
  fsEventsSettleRescan: true,
  envAllowlistExtra: [],
};
