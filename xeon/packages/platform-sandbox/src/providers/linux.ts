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
 * 홈 아래 Linux 시크릿 폴더: 브라우저 프로필(쿠키·저장된 로그인·방문 기록), 비밀번호 관리자, 키링, 메신저·메일 데이터.
 * snap·flatpak 브라우저는 프로필이 샌드박스 폴더 안에 있다.
 */
const HOME_SECRET_FOLDERS = [
  ".config/google-chrome",
  ".config/google-chrome-beta",
  ".config/chromium",
  ".config/microsoft-edge",
  ".config/BraveSoftware",
  ".config/vivaldi",
  ".config/opera",
  ".mozilla",
  ".thunderbird",
  "snap/firefox/common/.mozilla",
  "snap/chromium/common/chromium",
  ".var/app/org.mozilla.firefox",
  ".var/app/com.google.Chrome",
  ".var/app/org.chromium.Chromium",
  ".var/app/com.brave.Browser",
  ".var/app/com.microsoft.Edge",
  ".config/1Password",
  ".config/Bitwarden",
  ".config/KeePassXC",
  ".config/keepassxc",
  ".local/share/keyrings",
  ".local/share/kwalletd",
  ".config/Signal",
  ".config/Slack",
  ".config/discord",
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
