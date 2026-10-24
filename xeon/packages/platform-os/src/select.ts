import { readFileSync } from "node:fs";
import { release } from "node:os";
import { assertNever, attempt, err, ok, type Result } from "@xeon/contracts";
import type { OsArch, OsInfo, OsPlatform, PlatformError } from "@xeon/contracts/services";

// OS 분기 표현(process.platform, os.platform(), WSL 판정에 쓰는 환경 변수와 /proc 파일)은 이 패키지에서 이 파일에만
// 둔다(DR-13, L0.os.spec §1.1, OS-16). 다른 파일은 detectPlatform이 만든 OsInfo와 selectProviders의 결과만 쓴다.

/** 운영 환경에서 읽은 플랫폼 원시 값 */
export interface PlatformProbe {
  /** process.platform */
  readonly platform: string;
  /** process.arch */
  readonly arch: string;
  /** os.release() */
  readonly release: string;
  /** 환경 변수 WSL_DISTRO_NAME */
  readonly wslDistro: string | undefined;
  /** /proc/version 내용(linux만 읽는다) */
  readonly procVersion: string | undefined;
}

function readProcVersion(): string | undefined {
  const read = attempt(() => readFileSync("/proc/version", "utf8"));
  // /proc이 없는 OS(또는 읽기 거부)는 WSL이 아닌 것으로 본다. 판정은 undefined 값으로 돌려준다
  return read.ok ? read.value : undefined;
}

/** 운영에서 PlatformProbe를 채운다. 테스트는 이 함수를 쓰지 않고 probe를 직접 만든다 */
export function readPlatformProbe(): PlatformProbe {
  const platform = process.platform;
  const wsl = process.env["WSL_DISTRO_NAME"];
  return {
    platform,
    arch: process.arch,
    release: release(),
    wslDistro: wsl,
    procVersion: platform === "linux" ? readProcVersion() : undefined,
  };
}

function toPlatform(value: string): OsPlatform | undefined {
  switch (value) {
    case "darwin":
    case "linux":
    case "win32":
      return value;
    // xeon-disable-next-line xeon/switch-default-never -- process.platform은 지원 목록보다 넓은 외부 값이다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

function toArch(value: string): OsArch | undefined {
  switch (value) {
    case "x64":
    case "arm64":
      return value;
    // xeon-disable-next-line xeon/switch-default-never -- process.arch는 지원 목록보다 넓은 외부 값이다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

/** WSL 판정 [제안]: linux이고 배포판 이름 변수가 비어 있지 않거나 /proc/version에 microsoft 또는 WSL이 있다 */
function isWslKernel(probe: PlatformProbe): boolean {
  if (probe.wslDistro !== undefined && probe.wslDistro !== "") return true;
  if (probe.procVersion === undefined) return false;
  const lower = probe.procVersion.toLowerCase();
  return lower.includes("microsoft") || lower.includes("wsl");
}

/** 순수 함수. probe를 OsInfo로 바꾼다. 지원 밖 platform·arch는 예상 가능한 실패라 Result로 돌려준다 */
export function detectPlatform(probe: PlatformProbe): Result<OsInfo, PlatformError> {
  const platform = toPlatform(probe.platform);
  if (platform === undefined)
    return err({ kind: "unsupported_platform", platform: probe.platform });
  const arch = toArch(probe.arch);
  if (arch === undefined) return err({ kind: "unsupported_arch", arch: probe.arch });
  return ok({
    platform,
    arch,
    isWsl: platform === "linux" && isWslKernel(probe),
    release: probe.release.slice(0, 256),
  });
}

/** 파일 시스템 종류를 읽는 수단. statfs는 Linux, mount 출력은 macOS */
export type FsKindSource = "statfs" | "mount" | "none";
/** 기계 식별자를 읽는 수단 */
export type MachineIdSource = "etc-machine-id" | "ioreg" | "hostname";
/** 프로세스 시작 시각 지문을 읽는 수단 */
export type FingerprintSource = "proc" | "ps" | "unsupported";

/** OS마다 바뀌는 수단의 선택 결과. 구현은 각 기능 파일이 이 값으로 고른다 */
export interface OsProviders {
  readonly fsKind: FsKindSource;
  readonly machineId: MachineIdSource;
  readonly fingerprint: FingerprintSource;
}

/** 배포 환경이 provider를 덮어쓸 때 쓴다(조립 루트가 넘긴다). 비어 있으면 OS 기준으로 고른다 */
export interface EnvOverrides {
  readonly fsKind?: FsKindSource;
}

/** OsInfo로 provider 묶음을 고른다. provider 선택은 이 함수 한 곳에서 한다 */
export function selectProviders(info: OsInfo, overrides: EnvOverrides = {}): OsProviders {
  const base = baseProviders(info.platform);
  return { ...base, ...(overrides.fsKind === undefined ? {} : { fsKind: overrides.fsKind }) };
}

function baseProviders(platform: OsPlatform): OsProviders {
  switch (platform) {
    case "darwin":
      return { fsKind: "mount", machineId: "ioreg", fingerprint: "ps" };
    case "linux":
      return { fsKind: "statfs", machineId: "etc-machine-id", fingerprint: "proc" };
    case "win32":
      return { fsKind: "none", machineId: "hostname", fingerprint: "unsupported" };
    default:
      return assertNever(platform, "OsPlatform");
  }
}
