import { posix } from "node:path";
import type { ProtectedPathEntry } from "@xeon/contracts/services";
import type { RequiredBinary, SandboxProvider } from "../provider.ts";

const REQUIRED: readonly RequiredBinary[] = [
  { name: "rg", srtKey: "ripgrep.command", installHint: "brew install ripgrep" },
];

/** macOS: Seatbelt는 OS에 내장되어 있어 ripgrep만 필요하다 */
export function createDarwinProvider(): SandboxProvider {
  return {
    kind: "seatbelt",
    platform: "darwin",
    unsupported: undefined,
    requiredBinaries: () => REQUIRED,
    defaultProtectedPaths: (dirs) => {
      const entries: ProtectedPathEntry[] = [
        {
          path: posix.join(dirs.home, "Library", "Application Support", "sops", "age", "keys.txt"),
          match: "exact",
          access: "read_write",
          reason: "secret_key",
        },
        {
          path: posix.join(dirs.home, "Library", "LaunchAgents"),
          match: "prefix",
          access: "write",
          reason: "persistence",
        },
      ];
      return entries;
    },
  };
}
