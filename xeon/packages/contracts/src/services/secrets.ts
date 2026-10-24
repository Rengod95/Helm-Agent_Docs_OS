import type { Result } from "../base/index.ts";
import type {
  RedactionHit,
  SecretAuditRecord,
  SecretDenyReason,
  SecretHandle,
  SecretMeta,
  SecretName,
  SecretProviderId,
  SecretRefError,
  SecretUseMode,
} from "../capabilities/index.ts";
import type { LocalId } from "../conversation/index.ts";
import type { PortKey } from "../extensions/index.ts";

// L0.secrets.spec §3.3~§3.6, §3.10. 구현은 platform-secrets다. 참조 형식·메타·감사 레코드는 capabilities/secrets.ts가 정본이다
// (F.capabilities.spec §3.10, review.decisions-2 U-08). 이 파일은 서비스 인터페이스와 그 부속 타입이다.
// KeyProvider와 Redactor 구현, SOPS 래퍼는 platform-secrets 내부다.

export const SecretServiceName = "xeon.secrets" as const;

/** `xeon.secrets` 전체 모양(SecretService)의 포트 키. 제공 platform-secrets */
export const SecretServicePortKey: PortKey<SecretService> = { name: SecretServiceName };

// ── 사용 맥락과 lease ────────────────────────────────────────────────────

export type SecretUseTarget =
  /** runtime-http, sentinel */
  | { readonly kind: "host"; readonly host: string; readonly port: number | null }
  /** browser-input */
  | { readonly kind: "origin"; readonly origin: string }
  /** env */
  | { readonly kind: "command"; readonly argv0: string; readonly commandLine: string };

export interface ApprovalEvidence {
  /** L1 ApprovalService가 발급한 id */
  readonly approvalId: string;
  readonly scope: "per-session" | "per-use";
  readonly grantedAt: number;
  readonly expiresAt: number | null;
}

export interface UseCtx {
  readonly mode: SecretUseMode;
  /** 도구 이름 또는 서비스 메서드. "http.request", "bash:gh", "web.search", "model.provider:anthropic" */
  readonly purpose: string;
  readonly target: SecretUseTarget;
  readonly actor: "agent" | "runtime" | "human";
  /** 세션 밖 호출(서비스 모드, 관리 명령)은 null */
  readonly threadId: string | null;
  readonly toolCallId: string | null;
  readonly projectId: string | null;
  readonly approval: ApprovalEvidence | null;
}

export interface SecretValueView {
  /** 값 바이트. use 콜백이 끝나면 0으로 덮인다. 콜백 밖으로 복사하지 않는다 */
  readonly bytes: Uint8Array;
  /** UTF-8 문자열로 바꾼다. 문자열은 덮어쓸 수 없으므로 헤더 치환처럼 꼭 필요한 곳에서만 부른다 */
  text(): string;
}

/** 값을 반환하는 메서드(reveal, value, get)를 두지 않는다. 값은 use 콜백 인자로만 보인다 */
export interface SecretLease {
  /** "sls_<ULID>". F.conversation.spec §3.2.1 LocalIdPrefix */
  readonly leaseId: LocalId<"sls">;
  readonly handle: SecretHandle;
  readonly mode: SecretUseMode;
  readonly expiresAt: number;
  readonly usesLeft: number;
  /** 값 사용. 매번 만료·횟수·폐기·대상을 다시 검사한다(검사와 사용 사이 간극 방지) */
  use<T>(fn: (value: SecretValueView) => Promise<T> | T): Promise<Result<T, SecretError>>;
  /** 값을 0으로 덮고 lease를 닫는다. 두 번 불러도 된다 */
  dispose(): void;
  /** "[SecretLease <leaseId>]" */
  toJSON(): string;
}

// ── 제공자 ───────────────────────────────────────────────────────────────

export interface SecretProviderCapabilities {
  readonly list: boolean;
  readonly put: boolean;
  readonly remove: boolean;
  /** 제공자 자체 사용 이력(1Password Events API 등) */
  readonly usage: boolean;
}

/** 제공자가 아는 항목. 값과 메타 정책이 없다 */
export interface ProviderEntry {
  readonly provider: SecretProviderId;
  /** "dev/GITHUB_TOKEN" */
  readonly ref: string;
  /** sops는 파일의 sops.lastmodified [가정] */
  readonly updatedAt: number | null;
}

export interface SecretProvider {
  readonly id: SecretProviderId;
  capabilities(): SecretProviderCapabilities;
  /** 값 없는 목록. 복호화나 값 조회를 하지 않는다 */
  list(): Promise<Result<readonly ProviderEntry[], SecretError>>;
  /** 값을 lease로 연다. 부모 프로세스에서만 호출된다. 정책 검사는 SecretService가 끝낸 뒤다 */
  lease(
    ref: string,
    ctx: UseCtx,
    limits: { readonly ttlSeconds: number; readonly maxUses: number },
  ): Promise<Result<SecretLease, SecretError>>;
  put?(ref: string, value: Uint8Array): Promise<Result<void, SecretError>>;
  remove?(ref: string): Promise<Result<void, SecretError>>;
}

// ── 마스킹 ───────────────────────────────────────────────────────────────

export type RegisterKnownError = { readonly kind: "value_too_short"; readonly minBytes: 8 };

export interface Redactor {
  /** 알려진 값과 변형을 등록한다. 8바이트 미만은 거부한다 */
  registerKnown(name: SecretName, value: Uint8Array): Result<void, RegisterKnownError>;
  /** rotate·rm 뒤 이전 값 변형을 지운다 */
  forget(name: SecretName): void;
  mask(text: string): { readonly text: string; readonly hits: readonly RedactionHit[] };
  maskDeep<T>(value: T): { readonly value: T; readonly hits: readonly RedactionHit[] };
  /** 외부 전송 판정. 알려진 값이 들어 있으면 true. 값을 고치지 않는다 */
  containsKnown(text: string): boolean;
}

// ── 서비스 ───────────────────────────────────────────────────────────────

/** expiring: expiresAt까지 7일 이하 [제안]. missing: 메타는 있으나 제공자에 항목이 없음. orphaned: 제공자 항목에 메타가 없음 */
export type SecretStatus = "valid" | "expiring" | "expired" | "missing" | "orphaned";

export interface SecretListing {
  /** orphaned면 null */
  readonly meta: SecretMeta | null;
  /** missing이면 null */
  readonly entry: ProviderEntry | null;
  readonly handle: SecretHandle | null;
  readonly status: SecretStatus;
  readonly lastUsedAt: number | null;
}

export interface ApprovalPrompt {
  readonly handle: SecretHandle;
  readonly desc: string;
  readonly purpose: string;
  /** "어느 호스트에" */
  readonly target: SecretUseTarget;
  /** "몇 분간" */
  readonly ttlSeconds: number;
}

export type UseDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "needs_approval";
      readonly approval: "per-session" | "per-use";
      readonly prompt: ApprovalPrompt;
    }
  | { readonly kind: "deny"; readonly reason: SecretDenyReason };

export interface HttpTemplate {
  readonly method: string;
  /** 핸들을 넣을 수 없다 */
  readonly url: string;
  /** 값 자리에 "secret://<name>"이 올 수 있다 */
  readonly headers: Readonly<Record<string, string>>;
  /** 문자열 본문에 핸들이 올 수 있다 */
  readonly body: string | Uint8Array | null;
}

export interface ConcreteHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array | null;
}

export interface HttpResponseLike {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** 에코 검사 대상. 바이너리 본문은 null */
  readonly bodyText: string | null;
}

/**
 * 진단 결과(doctor·첫 실행 점검). 값은 싣지 않는다. 필드는 [가정]이다: L0.secrets.spec §3.6은 이름만 정하고
 * 내용은 plan SC-16(sops 유무·버전, 키 provider 상태, 파일 폴백 고지, orphaned 수, 등록 안내문)에 맞춰 정한다.
 */
export interface SecretDiagnostics {
  /** 등록 안내문. 첫 줄은 `just secret-add <키> [env]`, 둘째 줄은 `xeon secret add <name>` [제안] */
  readonly hints: readonly string[];
  /** sops 바이너리 */
  readonly sops: {
    readonly available: boolean;
    readonly version: string | null;
    readonly reason: "ok" | "binary_missing" | "version_too_old";
  };
  /** age 키 획득 경로 */
  readonly key: {
    readonly source: KeyProviderIdPublic;
    readonly available: boolean;
    readonly reason:
      | "ok"
      | "no_secret_service"
      | "keychain_locked"
      | "item_missing"
      | "not_implemented"
      | "file_mode";
  };
  /** 파일 폴백을 쓰고 있어 고지가 필요한가 */
  readonly fileFallbackNotice: boolean;
  readonly providers: readonly {
    readonly id: SecretProviderId;
    readonly registered: boolean;
    readonly entries: number | null;
  }[];
  /** 메타 파일과 제공자 항목의 불일치 수 */
  readonly missing: number;
  readonly orphaned: number;
}

export type KeyProviderIdPublic =
  | "darwin-keychain"
  | "linux-secret-service"
  | "win32-credential"
  | "file";

export type SecretError =
  | SecretRefError
  | {
      readonly kind: "secret_missing";
      readonly handle: SecretHandle;
      readonly where: "meta" | "provider";
    }
  | { readonly kind: "denied"; readonly handle: SecretHandle; readonly reason: SecretDenyReason }
  | {
      readonly kind: "provider_unavailable";
      readonly provider: SecretProviderId;
      readonly reason: "binary_missing" | "version_too_old" | "not_registered";
    }
  | {
      readonly kind: "key_unavailable";
      readonly key: KeyProviderIdPublic;
      readonly reason:
        | "locked"
        | "item_missing"
        | "no_secret_service"
        | "access_denied"
        | "file_mode";
    }
  | {
      readonly kind: "decrypt_failed";
      readonly provider: SecretProviderId;
      readonly exitCode: number | null;
      /** sops stderr를 Redactor.mask로 지나게 한 뒤 앞 500자 */
      readonly stderrMasked: string;
    }
  | {
      readonly kind: "meta_invalid";
      readonly name: string;
      readonly path: string;
      readonly errors: readonly string[];
    }
  | { readonly kind: "value_too_short"; readonly minBytes: 8 }
  | { readonly kind: "in_use"; readonly handle: SecretHandle; readonly activeLeases: number }
  | { readonly kind: "already_exists"; readonly handle: SecretHandle }
  | { readonly kind: "read_only_provider"; readonly provider: SecretProviderId }
  | { readonly kind: "reauth_required" }
  /** 서비스가 닫히면서 진행 중이던 sops 호출이나 바이너리 해석이 중단됐다 */
  | { readonly kind: "cancelled" };

export interface SecretService {
  readonly redactor: Redactor;

  /** 메타 조회. 값 없음. 복호화하지 않는다 */
  resolve(handle: SecretHandle): Promise<Result<SecretListing, SecretError>>;
  list(): Promise<Result<readonly SecretListing[], SecretError>>;
  /** 정책 판정만. 승인 요청 문구를 L1이 만들 수 있게 돌려준다 */
  check(handle: SecretHandle, ctx: UseCtx): Promise<Result<UseDecision, SecretError>>;
  /** check를 다시 하고 lease를 연다. 결과와 무관하게 감사 레코드를 낸다 */
  lease(handle: SecretHandle, ctx: UseCtx): Promise<Result<SecretLease, SecretError>>;

  /** M3: 템플릿의 핸들을 값으로 바꿔 send를 부르고, 응답 에코를 검사한 뒤 lease를 닫는다 */
  withHttp<T extends HttpResponseLike>(
    template: HttpTemplate,
    ctx: Omit<UseCtx, "mode" | "target">,
    send: (req: ConcreteHttpRequest) => Promise<T>,
  ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, SecretError>>;
  /**
   * M1(env): 승인된 명령의 자식 env에 넣을 값을 lease로 연다. ctx.target은 { kind: "command" }여야 하고
   * per-use 승인 증거가 필요하다 [결정(잠정): review.decisions-2 U-19]
   */
  withEnv(
    handle: SecretHandle,
    ctx: Omit<UseCtx, "mode">,
  ): Promise<Result<SecretLease, SecretError>>;
  /** M4: origin을 검사한 뒤 fill 콜백에만 값을 준다 */
  withBrowserInput<T>(
    handle: SecretHandle,
    origin: string,
    ctx: Omit<UseCtx, "mode" | "target">,
    fill: (value: SecretValueView) => Promise<T>,
  ): Promise<Result<T, SecretError>>;

  /** 샌드박스 읽기·쓰기 거부 대상인 비밀 파일 절대 경로(SOPS 파일, 메타 디렉터리, 감사 파일, 파일 폴백 age 키). 값 없음 */
  protectedPaths(): readonly string[];

  registerProvider(provider: SecretProvider): Result<Disposable, SecretError>;
  /** 감사 레코드 수신자 등록. 값은 실리지 않는다 */
  onAudit(sink: (record: SecretAuditRecord) => void): Disposable;
  /** doctor·첫 실행 점검. 값 없음 */
  diagnose(): Promise<SecretDiagnostics>;
}
