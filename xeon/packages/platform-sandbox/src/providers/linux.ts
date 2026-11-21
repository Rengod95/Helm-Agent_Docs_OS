import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { osCredentialEntries } from "../protected-paths.ts";
import type { RequiredBinary, SandboxProvider } from "../provider.ts";

const REQUIRED: readonly RequiredBinary[] = [
  {
    name: "bwrap",
    srtKey: "bwrapPath",
    installHint: "sudo apt install bubblewrap socat ripgrep (bubblewrap 0.4.0 or newer)",
  },
  { name: "socat", srtKey: "socatPath", installHint: "sudo apt install socat" },
  { name: "rg", srtKey: "ripgrep.command", installHint: "sudo apt install ripgrep" },
];

/** Linux와 WSL2: bubblewrap + seccomp. WSL2는 같은 provider에 platform만 다르다 */
export function createLinuxProvider(platform: "linux" | "wsl2"): SandboxProvider {
  return {
    kind: "bwrap",
    platform,
    unsupported: undefined,
    requiredBinaries: () => REQUIRED,
    defaultProtectedPaths: (dirs) => {
      const entries: ProtectedPathEntry[] = [
        // 비밀번호 관리자와 키링(제안 목록의 linux 줄): 쓰기만 막는다
        ...osCredentialEntries(dirs.home, "linux"),
      ];
      return entries;
    },
  };
}
