import type { Result } from "@fresnel/contracts";
import type { KeyProviderIdPublic, SecretError } from "@fresnel/contracts/services";

// L0.secrets.spec §3.7. age 키 획득. 이 패키지의 코드는 identity를 읽지 않는다. 키 명령이나 키 파일 경로를
// sops의 자식 env에 넘길 뿐이다. 예외는 두 가지다. 첫 쓰기의 provision이 만든 identity를 저장한다. 그리고
// keys.move(§4.7 1번 예외)가 `readIdentity`로 옛 쪽을 읽어 새 쪽에 `storeIdentity`로 옮긴다.

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
  /**
   * 첫 쓰기 설정: identity를 만들어 저장하고 수신자(공개키)만 돌려준다. 이미 있는 키는 덮어쓰지 않고
   * `write_failed`(code `EEXIST`)로 돌려준다. 파일 폴백과 macOS Keychain, Linux Secret Service가 구현한다
   */
  provision?(): Promise<Result<{ readonly recipient: string }, SecretError>>;
  /** OS 저장소에 age 키 항목이 있는가. 읽을 수 없어 모르면 null. identity는 읽지 않는다 */
  holdsKey?(): Promise<boolean | null>;
  /**
   * 저장된 identity를 읽는다(spec §4.7 1번 예외). `keys.move`와 수신자 확인에서만 부른다. 돌려준 버퍼는 호출자가
   * 쓴 뒤 0으로 덮는다. 항목이나 파일이 없으면 `key_unavailable`(`item_missing`)이다
   */
  readIdentity?(): Promise<Result<Uint8Array, SecretError>>;
  /**
   * identity를 없을 때만 저장한다. 이미 있으면 `write_failed`(code `EEXIST`)로 돌려주고 기존 것을 건드리지 않는다.
   * 넘긴 버퍼는 이 함수가 덮지 않는다(호출자 소유). 함수 안에서 만든 복사본만 쓴 뒤 0으로 덮는다
   */
  storeIdentity?(identity: Uint8Array): Promise<Result<void, SecretError>>;
  /** 항목이나 키 파일을 지운다. 이미 없으면 성공이다 */
  removeKey?(): Promise<Result<void, SecretError>>;
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
export const KEY_SERVICE = "fresnel.age";
export const KEY_ACCOUNT = "default";

const IDENTITY_PREFIX = new TextEncoder().encode("AGE-SECRET-KEY-1");

function isSpace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * 바이트 한 덩어리에서 identity 한 줄을 복사해 낸다. 앞뒤 공백과 줄바꿈은 뺀다. 모양이 맞지 않으면 null이다.
 * 원본 버퍼는 호출자가 0으로 덮는다. 돌려준 복사본은 호출자가 쓴 뒤 0으로 덮는다
 */
export function identityCopy(raw: Uint8Array): Uint8Array | null {
  let start = 0;
  let end = raw.length;
  while (start < end && isSpace(raw[start])) start += 1;
  while (end > start && isSpace(raw[end - 1])) end -= 1;
  // slice가 아니라 복사 생성자를 쓴다. Buffer.slice는 원본과 메모리를 공유하므로 원본을 덮으면 복사본도 지워진다
  const copy = new Uint8Array(raw.subarray(start, end));
  if (startsWith(copy, IDENTITY_PREFIX)) return copy;
  copy.fill(0);
  return null;
}
