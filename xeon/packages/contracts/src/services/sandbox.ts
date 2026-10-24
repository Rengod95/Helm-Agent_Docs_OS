import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/index.ts";
import type { CancelScope, Shell } from "./exec.ts";

// L0.sandbox.spec §3.1. 구현은 platform-sandbox다. exec와 sandbox는 서로 import하지 않고 F의 Shell 인터페이스로만 만난다.
// SandboxRunReport·SandboxViolation은 ./sandbox-report.ts다(exec.ts와 이 파일이 함께 쓴다).

export type { SandboxRunReport, SandboxViolation } from "./sandbox-report.ts";

export const SandboxServiceName = "xeon.sandbox" as const;

export type SandboxPlatform = "darwin" | "linux" | "wsl2" | "wsl1" | "win32" | "other";
export type SandboxUnavailableReason =
  | "missing_dependency"
  | "unsupported_os"
  | "self_test_failed"
  | "disabled";
export type OnUnavailable = "disable_execute" | "ask" | "run_unsandboxed";

export type SelfTestItemId =
  | "protected_read_denied"
  | "xeon_data_write_denied"
  | "network_denied"
  | "workspace_write_allowed"
  | "env_allowlist"
  | "git_hooks_write_denied";

export interface SandboxStatus {
  level: "srt" | "none";
  platform: SandboxPlatform;
  available: boolean;
  /** available이 거짓일 때만 */
  reason?: SandboxUnavailableReason;
  /** reason이 missing_dependency일 때 없는 프로그램 이름(예: "bwrap", "socat", "rg") */
  missing?: string[];
  /** missing에 대응하는 설치 안내(provider의 installHint). describeSandboxStatus가 hints로 옮긴다 */
  installHints?: string[];
  /** 적용 중인 격리 불가 정책(l0.sandbox.onUnavailable) */
  onUnavailable: OnUnavailable;
  /** 마지막 자가 시험. 아직 돌지 않았으면 없음 */
  lastSelfTest?: { at: number; passed: boolean; failed: SelfTestItemId[] };
}

const SELF_TEST_IDS = [
  "protected_read_denied",
  "xeon_data_write_denied",
  "network_denied",
  "workspace_write_allowed",
  "env_allowlist",
  "git_hooks_write_denied",
] as const;

const SelfTestIdSchema = Type.Union(SELF_TEST_IDS.map((id) => Type.Literal(id)));

const sandboxStatusShape = Type.Object(
  {
    level: Type.Union([Type.Literal("srt"), Type.Literal("none")]),
    platform: Type.Union([
      Type.Literal("darwin"),
      Type.Literal("linux"),
      Type.Literal("wsl2"),
      Type.Literal("wsl1"),
      Type.Literal("win32"),
      Type.Literal("other"),
    ]),
    available: Type.Boolean(),
    reason: Type.Optional(
      Type.Union([
        Type.Literal("missing_dependency"),
        Type.Literal("unsupported_os"),
        Type.Literal("self_test_failed"),
        Type.Literal("disabled"),
      ]),
    ),
    missing: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 16 })),
    installHints: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 })),
    onUnavailable: Type.Union([
      Type.Literal("disable_execute"),
      Type.Literal("ask"),
      Type.Literal("run_unsandboxed"),
    ]),
    lastSelfTest: Type.Optional(
      Type.Object(
        {
          at: Type.Integer({ minimum: 0 }),
          passed: Type.Boolean(),
          failed: Type.Array(SelfTestIdSchema, { maxItems: 6 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SandboxStatusSchema: TUnsafe<SandboxStatus> = Type.Unsafe<SandboxStatus>(
  sandboxStatusShape satisfies SchemaProof<SandboxStatus, typeof sandboxStatusShape>,
);

export interface SandboxNetworkPolicy {
  /** 빈 목록이면 네트워크 전부 차단. 1차는 항상 빈 목록 */
  allowedDomains: string[];
  /** 허용보다 먼저 검사한다(거부 우선) */
  deniedDomains: string[];
}

export interface SandboxPolicy {
  /** 절대·정규 경로. 쓰기를 허용하는 디렉터리 */
  writeRoots: string[];
  /** 읽기와 쓰기를 모두 거부하는 경로. 보호 경로(읽기)는 이 목록과 상관없이 항상 더해진다 */
  readDeny: string[];
  /** 쓰기를 거부하는 경로. 보호 경로(쓰기)는 항상 더해진다 */
  writeDeny: string[];
  network: SandboxNetworkPolicy;
  /** 참이면 이 호출을 샌드박스 밖에서 실행한다. L1 tools가 사람 승인을 받은 호출에만 참으로 둔다 */
  allowEscape: boolean;
}

const sandboxPolicyShape = Type.Object(
  {
    writeRoots: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 256 }),
    readDeny: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 1024 }),
    writeDeny: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 1024 }),
    network: Type.Object(
      {
        allowedDomains: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), {
          maxItems: 256,
        }),
        deniedDomains: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), {
          maxItems: 256,
        }),
      },
      { additionalProperties: false },
    ),
    allowEscape: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const SandboxPolicySchema: TUnsafe<SandboxPolicy> = Type.Unsafe<SandboxPolicy>(
  sandboxPolicyShape satisfies SchemaProof<SandboxPolicy, typeof sandboxPolicyShape>,
);

export type ProtectedAccess = "read_write" | "write";
export type ProtectedMatch = "exact" | "prefix" | "basename";

export interface ProtectedPathEntry {
  /** exact·prefix: 절대 정규 경로. basename: 파일 이름 패턴(끝의 *만 와일드카드) */
  path: string;
  match: ProtectedMatch;
  access: ProtectedAccess;
  /** basename 패턴의 예외 이름(예: ".env.example") */
  except?: string[];
  /** 표시용 이유 코드 */
  reason:
    | "xeon_data"
    | "xeon_config"
    | "secret_key"
    | "credentials"
    | "agent_credentials"
    | "shell_startup"
    | "git_exec"
    | "persistence"
    | "user_extra";
}

function basenameOf(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** 끝의 *만 와일드카드인 이름 패턴이 이름과 맞는가 */
function nameMatches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

function entryMatches(entry: ProtectedPathEntry, canonicalPath: string): boolean {
  switch (entry.match) {
    case "exact":
      return canonicalPath === entry.path;
    case "prefix": {
      const base = entry.path.length > 1 ? entry.path.replace(/\/+$/, "") : entry.path;
      return canonicalPath === base || canonicalPath.startsWith(`${base}/`);
    }
    case "basename": {
      const name = basenameOf(canonicalPath);
      return nameMatches(entry.path, name) && !(entry.except ?? []).includes(name);
    }
    // xeon-disable-next-line xeon/switch-default-never -- services는 다른 F 디렉터리에서 값을 가져오지 않아(test/services/imports.test.ts) assertNever를 못 쓴다. never 확인으로 완전성을 컴파일 시점에 검사하고, 런타임에 모르는 값이면 보호하는 쪽으로 닫는다 (eng.typescript.guide TY-14)
    default:
      entry.match satisfies never;
      return true;
  }
}

/**
 * 순수 함수. L2 파일 도구가 realpath 결과로 검사한다. 읽기는 read_write 항목만, 쓰기는 모든 항목이 막는다.
 * 경로 구분자는 "/"다(Windows 경로는 호출자가 정규화한다). 맞는 첫 항목을 돌려준다.
 */
export function matchProtectedPath(
  entries: readonly ProtectedPathEntry[],
  canonicalPath: string,
  access: "read" | "write",
): ProtectedPathEntry | undefined {
  return entries.find(
    (entry) =>
      (access === "write" || entry.access === "read_write") && entryMatches(entry, canonicalPath),
  );
}

export type AutoAllowBlock =
  | "sandbox_unavailable"
  | "escape_requested"
  | "write_root_outside"
  | "cwd_outside_write_roots"
  | "network_outside_default";

export type AutoAllowDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly blocks: readonly AutoAllowBlock[] };

export interface SelfTestItem {
  id: SelfTestItemId;
  passed: boolean;
  detail?: string;
}

export interface SelfTestReport {
  at: number;
  durationMs: number;
  passed: boolean;
  items: SelfTestItem[];
}

const selfTestReportShape = Type.Object(
  {
    at: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    passed: Type.Boolean(),
    items: Type.Array(
      Type.Object(
        {
          id: SelfTestIdSchema,
          passed: Type.Boolean(),
          detail: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 6 },
    ),
  },
  { additionalProperties: false },
);

export const SelfTestReportSchema: TUnsafe<SelfTestReport> = Type.Unsafe<SelfTestReport>(
  selfTestReportShape satisfies SchemaProof<SelfTestReport, typeof selfTestReportShape>,
);

export interface SandboxStatusSummary {
  severity: "ok" | "warn" | "critical";
  summary: string;
  hints: string[];
}

/**
 * 순수 함수. doctor·설정 화면·시작 로그가 쓴다. L4가 platform-sandbox를 import하지 않도록 F에 둔다.
 * 판정 기준 [제안]: 격리가 켜져 있으면 ok, 설정으로 껐으면(disabled) onUnavailable과 무관하게 warn이다.
 * 쓸 수 없는 경우는 onUnavailable이 disable_execute일 때만 critical(셸 도구를 쓸 수 없다)이고 나머지는 warn이다.
 * 자가 시험 실패는 항상 critical이다.
 */
export function describeSandboxStatus(status: SandboxStatus): SandboxStatusSummary {
  if (status.available && status.level === "srt") {
    return {
      severity: "ok",
      summary: `Sandbox is active (${status.platform}).`,
      hints: [],
    };
  }
  const severity = status.onUnavailable === "disable_execute" ? "critical" : "warn";
  const consequence =
    status.onUnavailable === "disable_execute"
      ? "Shell commands are disabled."
      : status.onUnavailable === "ask"
        ? "Shell commands need your approval to run without isolation."
        : "Shell commands run without isolation.";
  switch (status.reason) {
    case "missing_dependency": {
      const missing = status.missing ?? [];
      return {
        severity,
        summary: `Sandbox is unavailable: missing ${missing.length > 0 ? missing.join(", ") : "a required program"}. ${consequence}`,
        hints: [...(status.installHints ?? [])],
      };
    }
    case "unsupported_os":
      return {
        severity,
        summary: `Sandbox is not supported on ${status.platform}. ${consequence}`,
        hints: [],
      };
    case "self_test_failed": {
      const failed = status.lastSelfTest?.failed ?? [];
      return {
        severity: "critical",
        summary: `Sandbox self-test failed${failed.length > 0 ? `: ${failed.join(", ")}` : ""}. ${consequence}`,
        hints: ["Run the sandbox self-test again after fixing the failing items."],
      };
    }
    case "disabled":
      // 설정으로 끈 상태는 onUnavailable과 무관하게 격리 없이 실행한다(unsandboxedBy "disabled"). 항상 warn이다(L0.sandbox.spec §7)
      return {
        severity: "warn",
        summary: "Sandbox is turned off by setting. Shell commands run without isolation.",
        hints: ["Set l0.sandbox.enabled to true to isolate shell commands."],
      };
    case undefined:
      return { severity, summary: `Sandbox is unavailable. ${consequence}`, hints: [] };
    // xeon-disable-next-line xeon/switch-default-never -- services는 다른 F 디렉터리에서 값을 가져오지 않아(test/services/imports.test.ts) assertNever를 못 쓴다. never 확인으로 완전성을 컴파일 시점에 검사한다 (eng.typescript.guide TY-14)
    default:
      status.reason satisfies never;
      return { severity, summary: `Sandbox is unavailable. ${consequence}`, hints: [] };
  }
}

export interface SandboxService {
  status(): SandboxStatus;
  /** 작업 공간 root와 임시 디렉터리로 기본 정책을 만든다. 보호 경로와 설정 추가분이 들어간다 */
  defaultPolicy(input: { workspaceRoots: readonly string[]; tempDir: string }): SandboxPolicy;
  /** 보호 경로 전체(기본 + 설정 추가분). L2 파일 도구용 */
  protectedPaths(): readonly ProtectedPathEntry[];
  /** F Shell을 받아 F Shell을 돌려준다. exec 패키지를 import하지 않는다 */
  wrapShell(shell: Shell, policy: SandboxPolicy): Shell;
  /** 판정만 한다. 승인 UI와 적용은 L1 tools */
  autoAllow(
    policy: SandboxPolicy,
    request: {
      command: string | readonly string[];
      cwd: string;
      workspaceRoots: readonly string[];
      tempDir: string;
    },
  ): AutoAllowDecision;
  /** 주어진 Shell을 감싸 자가 시험을 실행하고 status에 반영한다 */
  selfTest(shell: Shell, context: CancelScope): Promise<SelfTestReport>;
}
