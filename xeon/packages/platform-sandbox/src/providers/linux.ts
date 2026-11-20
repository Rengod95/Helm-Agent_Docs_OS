import { posix } from "node:path";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
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

/**
 * 홈 아래 Linux 시크릿 폴더: 비밀번호 관리자와 키링.
 * 브라우저 프로필과 메신저·메일 데이터는 기본으로 막지 않는다 [결정: 2026-11-20, 사용자, AGE-63]. 막으려면 설정
 * `l0.sandbox.protectedPaths.extra`에 더한다.
 */
const HOME_SECRET_FOLDERS = [
  ".config/1Password",
  ".config/Bitwarden",
  ".config/KeePassXC",
  ".config/keepassxc",
  ".local/share/keyrings",
  ".local/share/kwalletd",
] as const;

/** Linux와 WSL2: bubblewrap + seccomp. WSL2는 같은 provider에 platform만 다르다 */
export function createLinuxProvider(platform: "linux" | "wsl2"): SandboxProvider {
  return {
    kind: "bwrap",
    platform,
    unsupported: undefined,
    requiredBinaries: () => REQUIRED,
    defaultProtectedPaths: (dirs) => {
      const entries: ProtectedPathEntry[] = [
        ...HOME_SECRET_FOLDERS.map((name): ProtectedPathEntry => ({
          path: posix.join(dirs.home, name),
          match: "prefix",
          access: "read_write",
          reason: "credentials",
        })),
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
