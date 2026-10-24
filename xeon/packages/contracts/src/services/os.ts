import { Type, type TUnsafe } from "typebox";
import type { Clock, Logger, RandomSource, Result, Scheduler, SchemaProof } from "../base/index.ts";
import type { ThreadId } from "../conversation/index.ts";
import type { PortKey } from "../extensions/index.ts";

// L0.os.spec §3. 구현은 platform-os다. Clock, Scheduler, RandomSource, Logger 인터페이스는 F 루트 base에 있다
// (review.decisions-2 U-03). 이 파일은 OsService와 그 값 타입이다.

export const OsServiceName = "xeon.os" as const;

/** `xeon.os` 전체 모양(OsService)의 포트 키. 제공 platform-os, 소비 core-context·cap-workspace·조립 루트 */
export const OsPortKey: PortKey<OsService> = { name: OsServiceName };

// ── 플랫폼 정보 ──────────────────────────────────────────────────────────

export type OsPlatform = "darwin" | "linux" | "win32";
export type OsArch = "x64" | "arm64";

export interface OsInfo {
  readonly platform: OsPlatform;
  readonly arch: OsArch;
  /** linux이고 WSL 커널일 때 true. 다른 플랫폼은 항상 false */
  readonly isWsl: boolean;
  /** os.release() 값. 표시와 진단용이며 분기에 쓰지 않는다 */
  readonly release: string;
}

const osInfoShape = Type.Object(
  {
    platform: Type.Union([Type.Literal("darwin"), Type.Literal("linux"), Type.Literal("win32")]),
    arch: Type.Union([Type.Literal("x64"), Type.Literal("arm64")]),
    isWsl: Type.Boolean(),
    release: Type.String({ maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const OsInfoSchema: TUnsafe<OsInfo> = Type.Unsafe<OsInfo>(
  osInfoShape satisfies SchemaProof<OsInfo, typeof osInfoShape>,
);

export type PlatformError =
  | { readonly kind: "unsupported_platform"; readonly platform: string }
  | { readonly kind: "unsupported_arch"; readonly arch: string };

// ── 디렉터리 ─────────────────────────────────────────────────────────────

export interface OsDirs {
  /** 사용자 홈(os.homedir()). 보호 경로 계산과 서비스 cwd에 쓴다. ensureDirs가 만들거나 검사하지 않는다 */
  readonly home: string;
  /** 세션 DB, 블롭, 지식 저장소 */
  readonly data: string;
  /** 사용자 설정 파일, 스킬·플러그인 설치 디렉터리 */
  readonly config: string;
  /** 지우고 다시 만들 수 있는 캐시(번들 바이너리 추출 위치 포함) */
  readonly cache: string;
  /** 로그, 복구 표식처럼 기기에 남는 상태 */
  readonly state: string;
  /** 서비스 소켓과 등록 파일. 짧은 경로여야 한다 */
  readonly runtime: string;
  /** 앱과 함께 배포된 읽기 전용 자원(번들 바이너리 원본 등) */
  readonly resource: string;
  /** 프로세스 단위 임시 파일 */
  readonly tmp: string;
}

export type DirsError =
  | PlatformError
  /** HOME, APPDATA 등 */
  | { readonly kind: "env_missing"; readonly name: string }
  | { readonly kind: "not_absolute"; readonly dir: keyof OsDirs; readonly path: string }
  | { readonly kind: "data_dir_on_drvfs"; readonly dir: keyof OsDirs; readonly path: string }
  | {
      readonly kind: "runtime_path_too_long";
      readonly path: string;
      readonly bytes: number;
      readonly limit: number;
    }
  /** 남이 만든 디렉터리 */
  | { readonly kind: "not_owned"; readonly path: string }
  | { readonly kind: "permission_too_open"; readonly path: string; readonly mode: number }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  /** 중단 신호로 멈췄다. 이미 만든 디렉터리는 그대로 둔다 */
  | { readonly kind: "cancelled" };

// ── 파일 시스템 종류 ─────────────────────────────────────────────────────

/** 값 집합의 정본은 F다. L0.store도 같은 타입을 쓴다 */
export type FsKind = "local" | "network" | "drvfs" | "unknown";

export type FsKindError =
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  | { readonly kind: "cancelled" };

// ── 시계, 타이머, 난수 ───────────────────────────────────────────────────

export interface OsTime {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly random: RandomSource;
}

// ── 외부 바이너리 ────────────────────────────────────────────────────────

export type BinaryName =
  | "rg"
  | "sops"
  | "age"
  | "git"
  | "bwrap"
  | "socat"
  | "security"
  | "secret-tool";
export type BinarySource = "bundled" | "system";

export interface ResolveBinaryOptions {
  /** 최소 버전(semver). 시스템 바이너리에만 적용한다 */
  readonly minVersion?: string;
  /** 기본 true. false면 번들만 본다 */
  readonly allowSystem?: boolean;
}

export interface ResolvedBinary {
  readonly name: BinaryName;
  /** 실행 가능한 절대 경로 */
  readonly path: string;
  readonly version: string;
  readonly source: BinarySource;
}

export type BinaryError =
  | PlatformError
  | {
      readonly kind: "not_found";
      readonly name: BinaryName;
      readonly searched: readonly string[];
      readonly hint: string;
    }
  | {
      readonly kind: "version_too_old";
      readonly name: BinaryName;
      readonly found: string;
      readonly required: string;
    }
  | { readonly kind: "version_unreadable"; readonly name: BinaryName; readonly path: string }
  | {
      readonly kind: "integrity_mismatch";
      readonly name: BinaryName;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly kind: "extract_failed"; readonly name: BinaryName; readonly code: string }
  | { readonly kind: "cancelled" };

// ── 사용자 알림 (1차, M3) ────────────────────────────────────────────────

/** L2.dialog.spec의 NoticeKind 5종을 이 4종으로 옮긴다 */
export type NotifyKind = "done" | "approval" | "question" | "error";

export interface OsNotification {
  readonly kind: NotifyKind;
  /** 1~80자 */
  readonly title: string;
  /** 0~400자. 마스킹을 거친 문자열만 */
  readonly body: string;
  readonly threadId?: ThreadId;
}

export type NotifyError =
  /** M3 이전 빌드이거나 조립 루트가 provider none을 고름 */
  | { readonly kind: "disabled" }
  | { readonly kind: "unavailable"; readonly provider: string; readonly reason: string }
  | { readonly kind: "failed"; readonly provider: string; readonly code: string }
  | { readonly kind: "cancelled" };

// ── 파일 감시 (2차) ──────────────────────────────────────────────────────

export type FileChangeType = "create" | "update" | "delete";

export interface FileChange {
  readonly type: FileChangeType;
  readonly path: string;
}

export interface WatchOptions {
  /** glob. 기본 [] */
  readonly ignore?: readonly string[];
  /** 기본 100. 0~5000 */
  readonly debounceMs?: number;
}

export interface WatchHandle {
  close(): Promise<void>;
}

export type WatchError =
  | { readonly kind: "outside_app_dirs"; readonly path: string }
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "limit_reached"; readonly backend: "native"; readonly detail: string }
  | { readonly kind: "backend_unavailable"; readonly reason: string };

// ── 텔레메트리 (2차) ─────────────────────────────────────────────────────

/**
 * OpenTelemetry Tracer 자리. F는 @opentelemetry/api를 import type으로만 쓰기로 했지만(F.readme §1) 이 패키지에는
 * 그 의존이 연결되어 있지 않다. startSpan을 가진 구조적 타입으로 두고, 의존이 연결되면 `Tracer`로 바꾼다 [가정].
 */
export interface OtelTracer {
  startSpan(name: string, ...rest: never[]): unknown;
}

export interface OsTelemetry {
  readonly enabled: boolean;
  /** 꺼져 있으면 무동작 Tracer를 돌려준다 */
  tracer(scope: string): OtelTracer;
}

// ── OsService ────────────────────────────────────────────────────────────

/** pid 프로세스의 시작 시각 지문을 얻을 수 없는 경우 */
export type FingerprintError =
  | { readonly kind: "unsupported"; readonly platform: OsPlatform }
  | { readonly kind: "io"; readonly code: string };

export interface OsService {
  readonly info: OsInfo;
  readonly dirs: OsDirs;
  readonly time: OsTime;
  /** 기계 식별자. 같은 기계 판정용(LeaseHolder.host). 서비스 수명 동안 바뀌지 않는다 */
  readonly machineId: string;
  /** POSIX uid. Windows는 null. /tmp/xeon-<uid>, 소켓 디렉터리 소유자 검사에 쓴다 */
  readonly userId: number | null;
  /** pid 프로세스의 시작 시각(epoch ms). 그 pid의 프로세스가 없으면 ok(null). 동기다(store 임대 판정이 동기 경로다) */
  processStartFingerprint(pid: number): Result<number | null, FingerprintError>;
  /** 구성요소 이름을 필드로 단 자식 로거 */
  logger(component: string): Logger;
  fsKind(path: string, signal: AbortSignal): Promise<Result<FsKind, FsKindError>>;
  resolveBinary(
    name: BinaryName,
    opts: ResolveBinaryOptions,
    signal: AbortSignal,
  ): Promise<Result<ResolvedBinary, BinaryError>>;
  /** 1차(M3). M3 이전 빌드에서는 항상 err({kind:"disabled"}) */
  notify(n: OsNotification, signal: AbortSignal): Promise<Result<void, NotifyError>>;
  /** 2차 */
  watch(
    root: string,
    opts: WatchOptions,
    onBatch: (changes: readonly FileChange[]) => void,
  ): Promise<Result<WatchHandle, WatchError>>;
  /** 2차 */
  readonly telemetry: OsTelemetry;
}
