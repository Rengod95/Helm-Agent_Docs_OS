import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type {
  BinaryError,
  BinaryName,
  BinarySource,
  OsPlatform,
  ResolvedBinary,
} from "@xeon/contracts/services";

// L0.os.spec §3.6.1. 외부 바이너리 필수/선택 표와 첫 실행 점검. 표는 OS별로 어느 바이너리를 어디에 쓰고,
// 없을 때 무엇이 안 되는지를 한 곳에 둔다. 점검 함수는 `resolveBinary`만 부르므로 서비스 없이 가짜로도 시험한다.

/** `required`는 없으면 해당 기능이 동작하지 않는다. `optional`은 없어도 대체 경로가 있다. `not_used`는 그 OS에서 쓰지 않는다 */
export type BinaryNeed = "required" | "optional" | "not_used";

export interface BinaryRequirement {
  readonly name: BinaryName;
  readonly need: BinaryNeed;
  /** 쓰는 곳 */
  readonly usedBy: string;
  /** 없을 때 영향. `optional`이면 대체 경로를 함께 적는다 */
  readonly impact: string;
  /** 시스템 바이너리의 최소 버전. 각 소비 패키지의 상수와 같아야 한다 */
  readonly minVersion?: string;
}

const SOPS_MIN_VERSION = "3.10.0";
const BWRAP_MIN_VERSION = "0.4.0";

const RG: BinaryRequirement = {
  name: "rg",
  need: "required",
  usedBy: "sandbox(srt), 작업 공간 파일 검색",
  impact: "파일 검색과 샌드박스 시작이 동작하지 않는다",
};
const SOPS: BinaryRequirement = {
  name: "sops",
  need: "required",
  usedBy: "secrets 기본 provider",
  impact: "비밀을 읽고 쓸 수 없다",
  minVersion: SOPS_MIN_VERSION,
};
const AGE: BinaryRequirement = {
  name: "age",
  need: "required",
  usedBy: "secrets 키 생성",
  impact: "새 비밀 키를 만들 수 없다",
};
const GIT: BinaryRequirement = {
  name: "git",
  need: "optional",
  usedBy: "작업 공간 git 기능",
  impact: "git 상태 표시와 작업 트리 기능만 빠진다",
};

function unused(name: BinaryName, why: string): BinaryRequirement {
  return { name, need: "not_used", usedBy: why, impact: "" };
}

/** 이 OS에서 점검할 바이너리 표. `not_used` 행은 점검하지 않는다 */
export function binaryRequirements(platform: OsPlatform): readonly BinaryRequirement[] {
  switch (platform) {
    case "darwin":
      return [
        RG,
        SOPS,
        AGE,
        GIT,
        unused("bwrap", "macOS는 Seatbelt를 쓴다"),
        unused("socat", "macOS는 Seatbelt를 쓴다"),
        {
          name: "security",
          need: "required",
          usedBy: "secrets 키 보관(Keychain)",
          impact: "Keychain에 키를 둘 수 없다. 시스템 구성을 확인한다",
        },
        unused("secret-tool", "Linux 전용"),
      ];
    case "linux":
      return [
        RG,
        SOPS,
        AGE,
        GIT,
        {
          name: "bwrap",
          need: "required",
          usedBy: "sandbox(l0.sandbox.enabled)",
          impact:
            "샌드박스를 쓸 수 없다. 설정(onUnavailable)에 따라 bash가 거부되거나 격리 없이 돈다",
          minVersion: BWRAP_MIN_VERSION,
        },
        {
          name: "socat",
          need: "required",
          usedBy: "sandbox 네트워크 중계(l0.sandbox.enabled)",
          impact:
            "샌드박스를 쓸 수 없다. 설정(onUnavailable)에 따라 bash가 거부되거나 격리 없이 돈다",
        },
        unused("security", "macOS 전용"),
        {
          name: "secret-tool",
          need: "optional",
          usedBy: "secrets 키 보관(Secret Service)",
          impact: "키를 파일(0600)에 둔다",
        },
      ];
    case "win32":
      return [
        RG,
        SOPS,
        AGE,
        GIT,
        unused("bwrap", "Windows 샌드박스는 지원하지 않는다"),
        unused("socat", "Windows 샌드박스는 지원하지 않는다"),
        unused("security", "macOS 전용"),
        unused("secret-tool", "Linux 전용"),
      ];
    default:
      return assertNever(platform, "OsPlatform");
  }
}

export type BinaryCheckStatus =
  | {
      readonly kind: "ok";
      readonly path: string;
      readonly version: string;
      readonly source: BinarySource;
    }
  | { readonly kind: "missing"; readonly hint: string }
  | { readonly kind: "too_old"; readonly found: string; readonly required: string }
  /** 찾았지만 쓸 수 없다. 값은 `BinaryError.kind` */
  | { readonly kind: "unusable"; readonly reason: BinaryError["kind"] };

export interface BinaryCheckItem {
  readonly name: BinaryName;
  readonly need: Exclude<BinaryNeed, "not_used">;
  readonly usedBy: string;
  readonly impact: string;
  readonly status: BinaryCheckStatus;
}

export interface BinaryCheckReport {
  readonly platform: OsPlatform;
  readonly items: readonly BinaryCheckItem[];
  /** 필수 바이너리가 모두 쓸 수 있으면 참 */
  readonly ready: boolean;
  /** 쓸 수 없는 필수 바이너리 이름 */
  readonly blocking: readonly BinaryName[];
  /** 쓸 수 없는 선택 바이너리 이름 */
  readonly degraded: readonly BinaryName[];
}

export interface BinaryCheckDeps {
  readonly platform: OsPlatform;
  readonly resolveBinary: (
    name: BinaryName,
    opts: { readonly minVersion?: string },
    signal: AbortSignal,
  ) => Promise<Result<ResolvedBinary, BinaryError>>;
}

function statusOf(result: Result<ResolvedBinary, BinaryError>): BinaryCheckStatus {
  if (result.ok) {
    const { path, version, source } = result.value;
    return { kind: "ok", path, version, source };
  }
  const failure = result.error;
  if (failure.kind === "not_found") return { kind: "missing", hint: failure.hint };
  if (failure.kind === "version_too_old") {
    return { kind: "too_old", found: failure.found, required: failure.required };
  }
  return { kind: "unusable", reason: failure.kind };
}

/**
 * 표의 모든 행을 `resolveBinary`로 확인해 보고서를 만든다. 확인은 병렬이고 서비스의 이름별 캐시를 그대로 쓴다.
 * 중단되면 `cancelled`다. 보고서는 값이고 실패 여부는 `ready`로 판단한다(첫 실행 안내와 doctor가 표시한다).
 */
export async function checkExternalBinaries(
  deps: BinaryCheckDeps,
  signal: AbortSignal,
): Promise<Result<BinaryCheckReport, { readonly kind: "cancelled" }>> {
  const rows = binaryRequirements(deps.platform).flatMap((row) =>
    row.need === "not_used" ? [] : [{ ...row, need: row.need }],
  );
  const checked = await Promise.all(
    rows.map(async (row): Promise<BinaryCheckItem> => {
      const result = await deps.resolveBinary(
        row.name,
        row.minVersion === undefined ? {} : { minVersion: row.minVersion },
        signal,
      );
      return {
        name: row.name,
        need: row.need,
        usedBy: row.usedBy,
        impact: row.impact,
        status: statusOf(result),
      };
    }),
  );
  if (signal.aborted) return err({ kind: "cancelled" });
  const failed = checked.filter((item) => item.status.kind !== "ok");
  const blocking = failed.filter((item) => item.need === "required").map((item) => item.name);
  const degraded = failed.filter((item) => item.need === "optional").map((item) => item.name);
  return ok({
    platform: deps.platform,
    items: checked,
    ready: blocking.length === 0,
    blocking,
    degraded,
  });
}
