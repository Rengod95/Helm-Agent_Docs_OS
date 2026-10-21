import { readFileSync } from "node:fs";
import type { SandboxProvider } from "./provider.ts";
import { createDarwinProvider } from "./providers/darwin.ts";
import { createLinuxProvider } from "./providers/linux.ts";
import { createNoneProvider } from "./providers/none.ts";
import { createWin32Provider } from "./providers/win32.ts";

// process.platform, process.arch, /proc/version을 읽는 유일한 파일이다(L0.sandbox.spec §3.5, DR-13).

export interface PlatformInput {
  /** process.platform */
  readonly platform: string;
  /** process.arch */
  readonly arch: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** linux만 /proc/version 내용 */
  readonly procVersion: string | undefined;
}

/** 현재 프로세스의 플랫폼 입력을 읽는다. 조립 루트가 한 번 부른다 */
export function detectPlatformInput(): PlatformInput {
  let procVersion: string | undefined;
  if (process.platform === "linux") {
    try {
      procVersion = readFileSync("/proc/version", "utf8");
    } catch {
      procVersion = undefined;
    }
  }
  return { platform: process.platform, arch: process.arch, env: process.env, procVersion };
}

type LinuxFlavor = "linux" | "wsl2" | "wsl1";

/** WSL 판정은 L0.os.spec §3.1 기준(WSL_DISTRO_NAME 또는 /proc/version)이고, WSL1과 WSL2를 나누는 것만 여기서 한다 */
function linuxFlavor(input: PlatformInput): LinuxFlavor {
  const version = input.procVersion ?? "";
  const hasWslName = (input.env["WSL_DISTRO_NAME"] ?? "") !== "";
  const looksWsl = hasWslName || /microsoft|wsl/i.test(version);
  if (!looksWsl) return "linux";
  if (/wsl2/i.test(version)) return "wsl2";
  // 커널 문자열에 Microsoft만 있고 WSL2가 없으면 WSL1이다. 문자열을 읽지 못했으면 srt의 WSL 검사가 다시 거른다
  if (/microsoft/i.test(version)) return "wsl1";
  return "wsl2";
}

/** 플랫폼 입력으로 provider를 고른다. throw하지 않는다 */
export function selectSandboxProvider(input: PlatformInput): SandboxProvider {
  switch (input.platform) {
    case "darwin":
      return createDarwinProvider();
    case "linux": {
      // seccomp 필터는 x64·arm64만 번들된다
      if (input.arch !== "x64" && input.arch !== "arm64") return createNoneProvider("linux");
      const flavor = linuxFlavor(input);
      if (flavor === "wsl1") return createNoneProvider("wsl1");
      return createLinuxProvider(flavor);
    }
    case "win32":
      return createWin32Provider();
    default:
      // xeon-disable-next-line xeon/switch-default-never -- 지원 목록 밖 OS는 오류 값(none provider)으로 돌려준다 (eng.typescript.guide TY-14)
      return createNoneProvider("other");
  }
}
