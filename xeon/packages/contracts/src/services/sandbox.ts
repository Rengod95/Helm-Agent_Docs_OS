import { Type, type TUnsafe } from "typebox";
import type { Result, SchemaProof } from "../base/index.ts";
import type { CancelScope, Shell } from "./exec.ts";
import type { SandboxRunReport, SandboxViolation } from "./sandbox-report.ts";

// L0.sandbox.spec §3.1. 구현은 platform-sandbox다. exec와 sandbox는 서로 import하지 않고 F의 Shell 인터페이스로만 만난다.
// SandboxRunReport·SandboxViolation은 ./sandbox-report.ts다(exec.ts와 이 파일이 함께 쓴다).

export type { SandboxRunReport, SandboxViolation };

export const SandboxServiceName = "fresnel.sandbox" as const;

export type SandboxPlatform = "darwin" | "linux" | "wsl2" | "wsl1" | "win32" | "other";
export type SandboxUnavailableReason =
  | "missing_dependency"
  | "unsupported_os"
  | "self_test_failed"
  | "disabled";
/** 격리를 쓸 수 없을 때의 정책(L0.sandbox.spec §4.5). 물어보기는 없다: 승인 흐름이 없어 막기와 같았다 [결정: 2026-11-11 사용자] */
export type OnUnavailable = "disable_execute" | "run_unsandboxed";

export type SelfTestItemId =
  | "protected_read_denied"
  | "fresnel_data_write_denied"
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
  /** srt 스키마가 받지 않아 차단 목록에서 빠진 도메인. 빠진 것이 없으면 없음(L0.sandbox.spec §3.2) */
  rejectedBlockedDomains?: string[];
}

const SELF_TEST_IDS = [
  "protected_read_denied",
  "fresnel_data_write_denied",
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
    onUnavailable: Type.Union([Type.Literal("disable_execute"), Type.Literal("run_unsandboxed")]),
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
    rejectedBlockedDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 256 }),
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

/**
 * 샌드박스 프로필. 생략은 보통 프로필이다(쓰기 루트가 `/`면 열린 정책, 셸 도구와 플러그인 격리·훑기·스크립트·MCP 서버의 기본). `"read-only"`는 쓰기 허용 루트 없음 + 네트워크 차단이다(서브에이전트 `explore`의 셸).
 * `"no-write"`는 쓰기 허용 루트 없음(호출 전용 빈 임시 폴더 하나만) + 읽기 허용 목록 + 네트워크는 정책 그대로다. 승인 전 플러그인 드래프트의 좁은 길(`narrow`, 설정 `l0.sandbox.narrowDrafts`)만 쓴다 [결정: 2026-11-21, 사용자, AGE-63].
 * `"script-env"`는 가져온 훅의 "스크립트 환경 프로필"이다(AGE-58 원칙 가, [제안] 이름): 읽기는 보호 경로만 거부하는 거부 목록 방식(`readAllow` 없음, 허용 폴더 `readCarveOuts` 예외만),
 * 쓰기는 프로젝트 폴더와 이 호출 전용 임시 폴더뿐, 네트워크는 정책 그대로, 그리고 스크립트 실행기의 막기(`toolDeny`, `machDeny`, `systemInfoDeny`, 덧붙이기 실패 시 띄우지 않기)를 그대로 얹는다
 */
export type SandboxProfile = "read-only" | "no-write" | "script-env";

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
  /** `"read-only"`면 `writeRoots`·`network` 값과 상관없이 읽기 전용 프로필로 감싼다. 샌드박스를 쓸 수 없으면 실행하지 않고 거부한다 */
  profile?: SandboxProfile;
  /**
   * 읽기 허용 목록. 있으면(빈 목록도) 이 경로 아래와 `readAllow`가 가리키는 파일만 읽는다(허용 목록 방식).
   * 없으면 지금처럼 보호 경로와 `readDeny`만 막는 거부 목록 방식이다. 보호 경로를 품은 항목은 정책 합성에서 빠진다
   */
  readAllow?: string[];
  /**
   * 읽기 허용 목록 방식에서 이름 하나만(하위 경로 없이) 읽게 하는 절대 경로. 심볼릭 링크 자체처럼 `readAllow`(하위 경로 포함, 정규 경로로 바뀜)로는 열 수 없는 것이다.
   * macOS(Seatbelt)에서만 쓰이고 프로필 맨 끝에 `(allow file-read* (literal ...))`로 더해진다. 다른 제공자는 무시한다 [제안, AGE-58]
   */
  readAllowLiteral?: string[];
  /**
   * 읽기 허용 목록 뒤에 다시 막는 파일(개별 도구). 허용한 폴더 안의 특정 실행 파일을 읽기와 실행 모두 막는다. 프로필 맨 끝에
   * `(deny file-read* ...)`와 `(deny process-exec ...)`로 더해져 앞의 허용을 이긴다. macOS(Seatbelt)에서만 쓰이고 다른 제공자는 무시한다 [제안, AGE-58]
   */
  toolDeny?: string[];
  /**
   * 프로필 맨 끝에서 다시 막는 Mach 서비스 이름(`(deny mach-lookup (global-name ...))`). 기본 프로필이 열어 둔 서비스(키체인 데몬, LaunchServices)를 도구를 거치지 않는
   * 호출도 못 쓰게 한다. macOS(Seatbelt)에서만 쓰이고 다른 제공자는 무시한다 [제안, AGE-58]
   */
  machDeny?: string[];
  /**
   * 참이면 프로필 맨 끝에서 시스템 정보 길을 막는다: 다른 프로세스의 정보(목록, 인자와 환경 변수, 실행 파일 경로, 작업 폴더, 열린 파일), 하드웨어 레지스트리(IOKit) 속성과 전원 관리 연결,
   * 다른 앱에 보내는 배포 알림. 자기 프로세스와 같은 샌드박스 안 프로세스의 정보는 그대로 읽힌다. 도구를 막아도 네이티브 호출(`bun:ffi`, `ctypes`)로 열리는 길이다.
   * macOS(Seatbelt)에서만 쓰이고 다른 제공자는 무시한다 [제안, AGE-58 후속]
   */
  systemInfoDeny?: boolean;
  /**
   * 보호 경로 안에서 다시 읽게 하는 경로(`"script-env"` 프로필만). 파일이면 그 이름 하나, 폴더면 그 아래 전부다. 프로필 맨 끝에 `(allow file-read* ...)`로 더해져 보호 경로 거부를 이긴다.
   * 보호 경로 자체나 그것을 품은 폴더는 받지 않는다(조용히 빼지 않고 실패한다). macOS(Seatbelt)에서만 쓰인다 [제안, AGE-58]
   */
  readCarveOuts?: string[];
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
    profile: Type.Optional(
      Type.Union([Type.Literal("read-only"), Type.Literal("no-write"), Type.Literal("script-env")]),
    ),
    readAllow: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 256 }),
    ),
    readAllowLiteral: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 64 }),
    ),
    toolDeny: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 128 }),
    ),
    machDeny: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 64 }),
    ),
    systemInfoDeny: Type.Optional(Type.Boolean()),
    readCarveOuts: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 64 }),
    ),
  },
  { additionalProperties: false },
);

export const SandboxPolicySchema: TUnsafe<SandboxPolicy> = Type.Unsafe<SandboxPolicy>(
  sandboxPolicyShape satisfies SchemaProof<SandboxPolicy, typeof sandboxPolicyShape>,
);

/** `read_write`는 읽기와 쓰기를 모두 거부한다. `write`는 쓰기만 거부한다(기본 자격 폴더는 이 값이다, L0.sandbox.spec §3.3) */
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
    | "fresnel_data"
    | "fresnel_config"
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
    // fresnel-disable-next-line fresnel/switch-default-never -- services는 다른 F 디렉터리에서 값을 가져오지 않아(test/services/imports.test.ts) assertNever를 못 쓴다. never 확인으로 완전성을 컴파일 시점에 검사하고, 런타임에 모르는 값이면 보호하는 쪽으로 닫는다 (eng.typescript.guide TY-14)
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
    // fresnel-disable-next-line fresnel/switch-default-never -- services는 다른 F 디렉터리에서 값을 가져오지 않아(test/services/imports.test.ts) assertNever를 못 쓴다. never 확인으로 완전성을 컴파일 시점에 검사한다 (eng.typescript.guide TY-14)
    default:
      status.reason satisfies never;
      return { severity, summary: `Sandbox is unavailable. ${consequence}`, hints: [] };
  }
}

/** `wrapArgv`에 넘기는 요청. 오래 사는 프로세스(stdio MCP 서버 등)의 명령줄이다 */
export interface SandboxArgvRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** 절대 경로. 정책의 상대 경로 기준이고 감싼 프로세스의 작업 디렉터리다. 없으면 호출 프로세스의 것을 따른다 */
  readonly cwd: string | undefined;
}

/**
 * 샌드박스 안에서 돌릴 명령줄. 호출자가 이 argv를 스트림 그대로 spawn한다.
 * `sandboxed`가 거짓이면 격리 없이 도는 명령줄이고(`unsandboxedBy`가 이유), argv는 요청 그대로다.
 */
export interface SandboxedArgv {
  readonly argv: readonly string[];
  /** 자식 env에 더할 항목(프록시 주소 등). 부모 env 전체가 아니라 부모와 다른 항목만이다 */
  readonly env: Readonly<Record<string, string>>;
  readonly sandboxed: boolean;
  /** `sandboxed`가 거짓일 때만. 사용자가 끄거나(`disabled`) 격리 불가 시 실행을 허락한(`run_unsandboxed`) 경우다 */
  readonly unsandboxedBy?: NonNullable<SandboxRunReport["unsandboxedBy"]>;
  /** 프로세스가 끝났거나 spawn에 실패하면 한 번 부른다. 여러 번 불러도 한 번만 한다 */
  cleanup(): void;
}

export type SandboxWrapError =
  /** 격리를 쓸 수 없고 `onUnavailable`이 실행을 허락하지 않는다(L0.sandbox.spec §4.5) */
  | { readonly kind: "unavailable"; readonly reason: SandboxUnavailableReason | undefined }
  /** 정책 변환이나 래핑이 실패했다. `message`에 경로나 값을 싣지 않는다 */
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "aborted" };

/**
 * 제안 목록의 이 기기 줄(AGE-63, L0.sandbox.spec §3.3.1). `path`는 설정 `extra`에 적는 모양(`~/…` 또는 절대 경로)이고,
 * `key`는 같은 경로를 보호 경로 비교에 쓰는 정규 절대 경로다.
 */
export interface SuggestedProtectedPathView {
  readonly path: string;
  readonly label: string;
  readonly key: string;
}

export interface SandboxService {
  status(): SandboxStatus;
  /** 작업 공간 root와 임시 디렉터리로 기본 정책을 만든다. 보호 경로와 설정 추가분이 들어간다 */
  defaultPolicy(input: {
    workspaceRoots: readonly string[];
    tempDir: string;
    /**
     * `"read-only"`면 쓰기 루트 없이 읽기 전용 프로필 정책을 만든다(`workspaceRoots`·`tempDir`는 무시).
     * `"no-write"`면 쓰기 루트 없음 + 읽기 허용 목록(`readRoots`와 런타임이 꼭 필요한 시스템 경로) 정책을 만든다(네트워크는 차단 목록 방식 그대로). 승인 전 드래프트의 좁은 길만 쓴다
     */
    profile?: SandboxProfile;
    /** `"no-write"`가 읽게 하는 경로(플러그인 폴더, 실행 파일). 절대 경로 */
    readRoots?: readonly string[];
    /** `"no-write"`에서만. 참이면 시스템 도구 폴더(`/bin`, `/usr/bin`)와 그 도구가 돌기 위한 시스템 경로를 읽기·실행 허용에 더한다(쓰기는 더하지 않는다). 열린 정책(`writeEverywhere`)에서는 무시한다 */
    systemTools?: boolean;
    /**
     * 보통 프로필에서만. 참이면 쓰기 범위 제한이 없다(쓰기 루트는 `/`, `workspaceRoots`·`tempDir`는 무시). 거부는 Fresnel 자신의 시크릿·데이터·설정(`secret_key`, `fresnel_data`,
     * `fresnel_config`)과 사용자가 더한 `l0.sandbox.protectedPaths.extra`(`user_extra`)뿐이다. 셸 도구, 플러그인 격리·훑기·스크립트, MCP stdio 서버가 쓴다 [결정: 2026-11-21, 사용자, AGE-63].
     * 생략하면 작업 공간과 임시 폴더만 쓰고 제안 목록 전체와 `.git` 항목을 쓰기 거부한다(쓰기 범위가 좁은 대화의 셸)
     */
    writeEverywhere?: boolean;
    /** `"script-env"`에서만. 쓰기 루트가 되는 프로젝트 폴더(절대 경로). 임시 폴더는 호출마다 샌드박스가 만든다 */
    projectDir?: string;
    /** `"script-env"`에서만. 보호 경로 안에서 읽게 하는 경로(가져올 때 지문을 적은 파일과 그 폴더) */
    readCarveOuts?: readonly string[];
  }): SandboxPolicy;
  /**
   * 보호 경로 전체. L2 파일 도구용. `roots`는 호출한 쪽이 지금 허용하는 작업 공간 root(정규 경로)다.
   * `roots`에 `/`가 있으면(쓰기 범위 제한 없음, 보통 대화) Fresnel 자신의 시크릿·데이터·설정과 사용자가 더한 `protectedPaths.extra`만 돌려준다.
   * 자격 폴더, 셸 시작 파일, `.git/hooks` 등은 기본으로 들어 있지 않다(사용자가 대화로 더한다).
   * `/`가 없으면(쓰기 범위가 좁은 대화, 승인 전 드래프트의 좁은 길) 제안 목록 전체와 root별 git 항목(`.git/hooks`, `.git/config` 등)을 쓰기 전용으로 더 돌려준다.
   * 생략하면 쓰기 범위가 좁은 쪽이고, root별 git 항목은 넣지 않는다. 열린 정책(`/`)의 목록은 쓰기 전용 줄을 넣지 않는다 [결정: 2026-11-21, 사용자, AGE-63].
   */
  protectedPaths(roots?: readonly string[]): readonly ProtectedPathEntry[];
  /**
   * 설정 `l0.sandbox.protectedPaths.extra`의 값 하나를 보호 경로 비교 키(정규 절대 경로)로 바꾼다. `resolveExtraPaths`와 같은 규칙이다
   * (`~`와 `~/…`는 홈 기준, 절대 경로는 그대로, 있는 경로는 실제 경로로 푼다). 그 밖의 값은 undefined다.
   * 같은 경로인지 견줄 때 쓴다(cap-workspace의 `sandbox_protect`는 이것으로 중복과 `/`·홈 거부를 정한다).
   */
  protectedPathKey(value: string): string | undefined;
  /** 이 기기에서 제안되는 경로 줄(`suggestedProtectedPaths(platform)`). 기본으로는 막지 않는 곳의 목록이고, 설정 extra에 적으면 읽기와 쓰기가 막힌다 */
  suggestedProtectedPaths(): readonly SuggestedProtectedPathView[];
  /** F Shell을 받아 F Shell을 돌려준다. exec 패키지를 import하지 않는다 */
  wrapShell(shell: Shell, policy: SandboxPolicy): Shell;
  /**
   * 오래 사는 프로세스를 정책 안에서 돌릴 명령줄을 만든다(stdio MCP 서버). `wrapShell`과 같은 정책 변환과
   * 격리 불가 판정(§4.5)을 쓰고, 끝난 결과가 아니라 argv를 돌려준다. 예상 가능한 실패는 값이다
   */
  wrapArgv(
    policy: SandboxPolicy,
    request: SandboxArgvRequest,
    context: CancelScope,
  ): Promise<Result<SandboxedArgv, SandboxWrapError>>;
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
  /**
   * 주어진 Shell을 감싸 자가 시험을 실행하고 status에 반영한다. 예약 시험과 사람이 누른 시험은 한 번에 하나씩 돈다(같은 시험 폴더를 쓴다)
   */
  selfTest(shell: Shell, context: CancelScope): Promise<SelfTestReport>;
  /**
   * 마지막으로 기록된 자가 시험 보고서 전체(항목별 통과와 사유, 시각). 아직 돌지 않았거나 격리를 쓸 수 없어 기록하지 않았으면 없다.
   * `status().lastSelfTest`가 실패한 항목 id만 싣는 것과 달리 항목 전부를 싣는다
   */
  lastSelfTestReport(): SelfTestReport | undefined;
}
