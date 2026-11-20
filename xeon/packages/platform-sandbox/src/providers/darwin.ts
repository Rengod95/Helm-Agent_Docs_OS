import { posix } from "node:path";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import type { RequiredBinary, SandboxProvider } from "../provider.ts";

const REQUIRED: readonly RequiredBinary[] = [
  { name: "rg", srtKey: "ripgrep.command", installHint: "brew install ripgrep" },
];

/** 시스템 키체인 폴더. 홈 밖의 절대 경로다 */
const SYSTEM_KEYCHAINS = ["/Library/Keychains"] as const;

/**
 * 홈 아래 macOS 시크릿 폴더: 키체인과 비밀번호 관리자.
 * 브라우저 프로필과 메신저·메일 데이터는 기본으로 막지 않는다 [결정: 2026-11-20, 사용자, AGE-63]. 막으려면 설정
 * `l0.sandbox.protectedPaths.extra`에 더한다. Safari·Messages·Mail은 macOS가 스스로 막는다(TCC).
 */
const HOME_SECRET_FOLDERS = [
  "Library/Keychains",
  "Library/Cookies",
  "Library/Application Support/1Password",
  "Library/Application Support/Bitwarden",
  "Library/Application Support/KeePassXC",
  "Library/Group Containers/2BUA8C4S2C.com.1password",
  "Library/Containers/com.1password.1password",
] as const;

function secretEntry(path: string): ProtectedPathEntry {
  return { path, match: "prefix", access: "read_write", reason: "credentials" };
}

/** macOS: Seatbelt는 OS에 내장되어 있어 ripgrep만 필요하다 */
export function createDarwinProvider(): SandboxProvider {
  return {
    kind: "seatbelt",
    platform: "darwin",
    unsupported: undefined,
    requiredBinaries: () => REQUIRED,
    defaultProtectedPaths: (dirs) => {
      const entries: ProtectedPathEntry[] = [
        ...SYSTEM_KEYCHAINS.map(secretEntry),
        ...HOME_SECRET_FOLDERS.map((name) => secretEntry(posix.join(dirs.home, name))),
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
