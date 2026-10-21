import type { Result } from "../base/index.ts";
import type {
  ReauthMethod,
  SecretApproval,
  SecretAuditRecord,
  SecretHandle,
  SecretMeta,
  SecretScope,
  SecretUsePolicy,
} from "../capabilities/index.ts";
import type { SecretError, SecretListing, SecretValueView } from "./secrets.ts";

// L0.secrets.spec §3.8. 구현은 platform-secrets다. 에이전트는 생성과 열람을 하지 않으므로 관리 메서드를 별도 서비스로 나눈다.
// 조립 루트(apps/host)가 L4 진입점에만 이 서비스를 넘기고 확장과 모델 도구에는 주지 않는다.

export const SecretAdminServiceName = "xeon.secretAdmin" as const;

export interface SecretValueSource {
  /** L4가 넘기는 값 입력 통로. stdin 또는 가린 프롬프트. argv 경로는 타입에 없다 */
  read(): Promise<Result<Uint8Array, { readonly kind: "input_cancelled" | "input_empty" }>>;
}

export interface HumanReauth {
  /** tty-confirm: OS 인증 재확인을 쓸 수 없는 터미널에서 사람이 TTY로 직접 확인한 경우(CLI reveal 전용) */
  readonly method: ReauthMethod;
  /** L4·L0.os가 확인한 시각. 60초 안이어야 한다 [제안] */
  readonly verifiedAt: number;
}

export interface SecretMetaPatch {
  readonly desc?: string;
  readonly scope?: SecretScope;
  readonly expiresAt?: string | null;
  readonly use?: SecretUsePolicy;
  readonly approval?: SecretApproval;
  readonly ttlSeconds?: number;
  readonly maxUses?: number;
}

export interface SecretTestResult {
  readonly exists: boolean;
  readonly decryptable: boolean;
  /** 바이트 */
  readonly length: number | null;
  /** hex 앞 8자. 사람에게만 보인다 */
  readonly sha256Prefix: string | null;
}

export interface SecretReferenceReport {
  /** 이 핸들을 값으로 가진 설정 키 */
  readonly settingKeys: readonly string[];
  readonly activeLeases: number;
  /** 최근 사용 threadId */
  readonly sessions: readonly string[];
}

export interface SecretAdminService {
  ls(options: { readonly usage: boolean }): Promise<Result<readonly SecretListing[], SecretError>>;
  usage(
    handle: SecretHandle,
    filter: { readonly since?: number; readonly decision?: "allow" | "deny" },
  ): Promise<Result<readonly SecretAuditRecord[], SecretError>>;
  add(meta: SecretMeta, value: SecretValueSource): Promise<Result<SecretHandle, SecretError>>;
  set(handle: SecretHandle, value: SecretValueSource): Promise<Result<void, SecretError>>;
  meta(handle: SecretHandle, patch: SecretMetaPatch): Promise<Result<SecretMeta, SecretError>>;
  rotate(
    handle: SecretHandle,
    value: SecretValueSource,
  ): Promise<Result<{ readonly revokedLeases: number }, SecretError>>;
  references(handle: SecretHandle): Promise<Result<SecretReferenceReport, SecretError>>;
  rm(
    handle: SecretHandle,
    confirm: { readonly confirmed: true },
  ): Promise<Result<void, SecretError>>;
  test(handle: SecretHandle): Promise<Result<SecretTestResult, SecretError>>;
  /** 사람 직접 실행 전용 M1. env 이름 → 핸들. 자식 프로세스를 띄워 종료 코드를 돌려준다 */
  run(
    env: Readonly<Record<string, SecretHandle>>,
    argv: readonly string[],
    io: { readonly inheritStdio: true },
  ): Promise<Result<{ readonly exitCode: number }, SecretError>>;
  /** 사람에게 한 번 보이고 숨긴다. show 콜백은 OS 보안 창이나 TTY에만 쓴다 */
  reveal(
    handle: SecretHandle,
    reauth: HumanReauth,
    show: (value: SecretValueView) => Promise<void>,
  ): Promise<Result<void, SecretError>>;
}
