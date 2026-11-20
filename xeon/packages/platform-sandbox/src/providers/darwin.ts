import { posix } from "node:path";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { osCredentialEntries } from "../protected-paths.ts";
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
        // 키체인, 쿠키, 비밀번호 관리자 폴더(제안 목록의 darwin 줄): 쓰기만 막는다
        ...osCredentialEntries(dirs.home, "darwin"),
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
