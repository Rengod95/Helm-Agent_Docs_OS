import { posix } from "node:path";
import type { ProtectedPathEntry } from "@xeon/contracts/services";
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
        {
          path: posix.join(dirs.home, ".config", "systemd", "user"),
          match: "prefix",
          access: "write",
          reason: "persistence",
        },
      ];
      return entries;
    },
  };
}
