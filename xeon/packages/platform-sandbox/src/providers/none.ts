import type { SandboxPlatform } from "@xeon/contracts/services";
import type { SandboxProvider } from "../provider.ts";

/** 격리 수단이 없는 환경(WSL1, 지원 밖 아키텍처, 그 밖의 OS). status는 none, unsupported_os다 */
export function createNoneProvider(platform: SandboxPlatform): SandboxProvider {
  return {
    kind: "none",
    platform,
    unsupported: "unsupported_os",
    requiredBinaries: () => [],
    defaultProtectedPaths: () => [],
  };
}
