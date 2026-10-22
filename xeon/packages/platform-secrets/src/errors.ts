import type { SecretDenyReason, SecretHandle } from "@xeon/contracts/capabilities";
import type { Redactor, SecretError } from "@xeon/contracts/services";

/** `decrypt_failed.stderrMasked`의 길이 상한(spec §3.10) */
const STDERR_MASKED_MAX_CHARS = 500;

export function deniedError(handle: SecretHandle, reason: SecretDenyReason): SecretError {
  return { kind: "denied", handle, reason };
}

/** sops stderr를 Redactor.mask로 지나게 한 뒤 앞 500자만 둔다. 오류 객체에는 이 결과만 싣는다 */
export function maskStderr(redactor: Pick<Redactor, "mask">, stderr: string): string {
  return redactor.mask(stderr).text.slice(0, STDERR_MASKED_MAX_CHARS);
}

/** 오류에 값이 섞이지 않게 예외 메시지를 로그용 고정 문구로 줄인다. cause 객체는 싣지 않는다 */
export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code: unknown = Reflect.get(error, "code");
    if (typeof code === "string") return code;
    return error.name;
  }
  return "unknown";
}

/**
 * 감사 파일을 쓸 수 없다. SecretError에 전용 변형이 없어(F 요청 대기) 파일 문제를 뜻하는 meta_invalid로 돌려준다.
 * 열람처럼 기록 없이는 진행하면 안 되는 동작이 이 오류로 멈춘다.
 */
export function auditUnavailable(path: string, code: string): SecretError {
  return { kind: "meta_invalid", name: "audit.log", path, errors: [`unwritable (${code})`] };
}
