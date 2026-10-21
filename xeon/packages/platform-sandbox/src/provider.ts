import type { OsDirs, ProtectedPathEntry, SandboxPlatform } from "@xeon/contracts/services";

// L0.sandbox.spec §3.5. OS 분기는 select.ts가 고르고, 구현은 providers/*다(DR-13).

export interface RequiredBinary {
  readonly name: "rg" | "bwrap" | "socat";
  readonly srtKey: "ripgrep.command" | "bwrapPath" | "socatPath";
  /** 예: "brew install ripgrep", "sudo apt install bubblewrap socat ripgrep" */
  readonly installHint: string;
}

export interface SandboxProvider {
  readonly kind: "seatbelt" | "bwrap" | "none";
  readonly platform: SandboxPlatform;
  /** kind가 none이면 이유 */
  readonly unsupported: "unsupported_os" | undefined;
  requiredBinaries(): readonly RequiredBinary[];
  /** OS별 보호 경로. 공통 표는 protected-paths.ts가 갖는다 */
  defaultProtectedPaths(
    dirs: Pick<OsDirs, "home" | "data" | "config">,
  ): readonly ProtectedPathEntry[];
}
