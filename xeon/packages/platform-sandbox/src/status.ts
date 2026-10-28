import type {
  OnUnavailable,
  OsService,
  SandboxStatus,
  SandboxUnavailableReason,
  SelfTestItemId,
} from "@xeon/contracts/services";
import type { SandboxProvider } from "./provider.ts";
import type { SrtPort } from "./srt.ts";
import type { SrtTools } from "./policy.ts";

// L0.sandbox.spec §4.1 상태 탐지. 시작 때 한 번 하고, 설정 변경과 자가 시험 뒤에 다시 한다.

/** 탐지 결과. ready이면 srt를 초기화할 수 있다 */
export type Detection =
  | { readonly kind: "ready"; readonly tools: SrtTools }
  | {
      readonly kind: "unavailable";
      readonly reason: SandboxUnavailableReason;
      readonly missing: readonly string[];
      readonly installHints: readonly string[];
    };

export interface DetectDeps {
  readonly provider: SandboxProvider;
  readonly srt: SrtPort;
  readonly resolveBinary: OsService["resolveBinary"];
}

const HINT_MAX = 500;
const BWRAP_MIN_VERSION = "0.4.0";

function unavailable(
  reason: SandboxUnavailableReason,
  missing: readonly string[] = [],
  installHints: readonly string[] = [],
): Detection {
  return { kind: "unavailable", reason, missing, installHints };
}

/**
 * srt가 돌려준 오류 문장을 상태 값으로 옮긴다(오류 이름 대응은 구현에서 정한다, spec §4.1 4번 [가정]).
 * 알아보지 못한 문장은 설치 안내에 그대로 싣는다(길이만 자른다).
 */
export function classifySrtMessages(
  messages: readonly string[],
  provider: Pick<SandboxProvider, "requiredBinaries">,
): Detection {
  const missing: string[] = [];
  const hints: string[] = [];
  let unsupported = false;
  for (const message of messages) {
    const lower = message.toLowerCase();
    if (lower.includes("unsupported platform")) {
      unsupported = true;
    } else if (lower.includes("bwrap") || lower.includes("bubblewrap")) {
      missing.push("bwrap");
    } else if (lower.includes("socat")) {
      missing.push("socat");
    } else if (lower.includes("ripgrep") || /\brg\b/.test(lower)) {
      missing.push("rg");
    } else if (lower.includes("seccomp")) {
      missing.push("seccomp");
      hints.push("The seccomp helper bundled with the sandbox runtime was not found.");
    } else {
      hints.push(message.slice(0, HINT_MAX));
    }
  }
  if (unsupported) return unavailable("unsupported_os");
  const names = [...new Set(missing)];
  const known = provider.requiredBinaries();
  const installHints = [
    ...new Set([
      ...names.flatMap((name) =>
        known.filter((bin) => bin.name === name).map((bin) => bin.installHint),
      ),
      ...hints,
    ]),
  ];
  return unavailable("missing_dependency", names, installHints);
}

/** 초기화 실패를 상태로 옮긴다. 오류 이름만 싣는다(메시지에 경로 외 다른 값이 들 수 있다) */
export function classifyInitFailure(caught: unknown, provider: SandboxProvider): Detection {
  const text = caught instanceof Error ? caught.message : "";
  // srt는 의존성 오류를 "Sandbox dependencies not available: a, b" 한 문장으로 던진다
  const prefix = "Sandbox dependencies not available:";
  if (text.startsWith(prefix)) {
    return classifySrtMessages(text.slice(prefix.length).split(", "), provider);
  }
  const name = caught instanceof Error ? caught.name : typeof caught;
  return unavailable("missing_dependency", [], [`Sandbox runtime failed to initialize (${name}).`]);
}

/** 4.1절 1~4번. 설정이 꺼졌으면 provider와 PATH를 보지 않는다 */
export async function detectSandbox(
  deps: DetectDeps,
  enabled: boolean,
  signal: AbortSignal,
): Promise<Detection> {
  if (!enabled) return unavailable("disabled");
  const { provider, srt } = deps;
  if (provider.unsupported !== undefined) return unavailable(provider.unsupported);

  const missing: string[] = [];
  const hints: string[] = [];
  const found: { bwrapPath?: string; socatPath?: string; ripgrepCommand?: string } = {};
  const resolved = await Promise.all(
    provider.requiredBinaries().map(async (bin) => ({
      bin,
      result: await deps.resolveBinary(
        bin.name,
        bin.name === "bwrap" ? { minVersion: BWRAP_MIN_VERSION } : {},
        signal,
      ),
    })),
  );
  for (const { bin, result } of resolved) {
    if (!result.ok) {
      missing.push(bin.name);
      hints.push(bin.installHint);
    } else if (bin.srtKey === "bwrapPath") {
      found.bwrapPath = result.value.path;
    } else if (bin.srtKey === "socatPath") {
      found.socatPath = result.value.path;
    } else {
      found.ripgrepCommand = result.value.path;
    }
  }
  if (missing.length > 0) return unavailable("missing_dependency", missing, [...new Set(hints)]);

  if (!srt.isSupportedPlatform()) return unavailable("unsupported_os");
  const report = srt.checkDependencies(found.ripgrepCommand);
  if (report.errors.length > 0) return classifySrtMessages(report.errors, provider);
  return { kind: "ready", tools: found };
}

export interface StatusInput {
  readonly provider: SandboxProvider;
  /** 지금 설정이 켜졌는가. 꺼졌으면 마지막 탐지 결과와 관계없이 disabled다 */
  readonly enabled: boolean;
  /** 마지막 탐지 결과 */
  readonly detection: Detection;
  readonly onUnavailable: OnUnavailable;
  readonly lastSelfTest: { at: number; passed: boolean; failed: SelfTestItemId[] } | undefined;
  /** srt가 거부해 차단 목록에서 빠진 도메인. 없거나 빈 목록이면 status에 키가 없다 */
  readonly rejectedBlockedDomains?: readonly string[];
}

/** 탐지 결과, 설정, 마지막 자가 시험을 합쳐 SandboxStatus를 만든다. 순수 함수 */
export function buildStatus(input: StatusInput): SandboxStatus {
  const { provider, onUnavailable, lastSelfTest } = input;
  const selfTest = lastSelfTest === undefined ? {} : { lastSelfTest };
  const rejectedList = input.rejectedBlockedDomains ?? [];
  const rejected = rejectedList.length > 0 ? { rejectedBlockedDomains: [...rejectedList] } : {};
  const none = {
    level: "none",
    platform: provider.platform,
    available: false,
    onUnavailable,
    ...selfTest,
    ...rejected,
  } as const;
  if (!input.enabled) return { ...none, reason: "disabled" };
  const detection = input.detection;
  if (detection.kind === "unavailable") {
    return {
      ...none,
      reason: detection.reason,
      ...(detection.missing.length > 0 ? { missing: [...detection.missing] } : {}),
      ...(detection.installHints.length > 0 ? { installHints: [...detection.installHints] } : {}),
    };
  }
  if (lastSelfTest !== undefined && !lastSelfTest.passed) {
    return { ...none, reason: "self_test_failed" };
  }
  return {
    level: "srt",
    platform: provider.platform,
    available: true,
    onUnavailable,
    ...selfTest,
    ...rejected,
  };
}

/** 시작 로그 한 줄(spec §4.6). 값 없이 상태 필드만 싣는다 */
export function formatStatusLine(status: SandboxStatus): string {
  return `sandbox level=${status.level} platform=${status.platform} available=${String(status.available)} reason=${status.reason ?? "none"} onUnavailable=${status.onUnavailable}`;
}
