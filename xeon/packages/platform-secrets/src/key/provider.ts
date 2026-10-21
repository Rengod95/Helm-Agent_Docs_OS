import type { Result } from "@xeon/contracts";
import type { KeyProviderIdPublic, SecretError } from "@xeon/contracts/services";

// L0.secrets.spec §3.7. age 키 획득. 이 패키지의 코드는 identity를 읽지 않는다. 키 명령이나 키 파일 경로를
// sops의 자식 env에 넘길 뿐이다. 예외는 첫 실행의 provision(마일스톤 M1에서는 구현하지 않는다).

type KeyProviderId = KeyProviderIdPublic;

export interface KeyAvailability {
  readonly available: boolean;
  readonly reason:
    | "ok"
    | "no_secret_service"
    | "keychain_locked"
    | "item_missing"
    | "not_implemented"
    | "file_mode";
}

export type SopsKeyEnvName = "SOPS_AGE_KEY_CMD" | "SOPS_AGE_KEY_FILE";

export interface KeyProvider {
  readonly id: KeyProviderId;
  /** 키 저장소 존재 여부만 본다. identity를 읽지 않는다 */
  probe(): Promise<KeyAvailability>;
  /** sops 자식 env에 넣을 변수. SOPS_AGE_KEY_CMD 또는 SOPS_AGE_KEY_FILE 하나 */
  sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError>;
  /** 첫 실행 설정: identity를 만들어 저장하고 수신자(공개키)만 돌려준다. age-encryption 의존이 연결되기 전에는 없다 */
  provision?(): Promise<Result<{ readonly recipient: string }, SecretError>>;
}

/**
 * 키 명령 한 인자를 작은따옴표로 감싼다. 키 명령은 셸 없이 실행되고 google/shlex 규칙으로 나뉜다.
 * 따옴표 밖의 백슬래시는 사라지므로 모든 인자를 감싸고, 인자 안의 작은따옴표는 `'\''`로 이어 붙인다.
 */
export function shlexQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function keyCommand(argv: readonly string[]): string {
  return argv.map(shlexQuote).join(" ");
}

/** age 키 항목 이름(spec §3.7 표) */
export const KEY_SERVICE = "xeon.age";
export const KEY_ACCOUNT = "default";
