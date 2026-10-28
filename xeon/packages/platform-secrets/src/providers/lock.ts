import { assertNever, ok, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";

// L0.secrets.spec §4.6 8번. SOPS 파일의 읽고-고치고-쓰기와 첫 파일 만들기를 프로세스 사이에서 차례로 하게 하는 잠금.
// 운영은 xeon.os의 파일 잠금(`OsServiceHandle.fileLock`, L0.os.spec §3.11)을 넘긴다. 같은 층이라 타입을 import하지 않고 필요한 모양만 적는다.

export type SecretFileLockError =
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "io"; readonly code: string };

export interface SecretFileLock {
  withLock<T>(
    path: string,
    fn: () => Promise<T>,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<Result<T, SecretFileLockError>>;
}

/** 경로별로 마지막 작업의 꼬리. 같은 프로세스의 모든 조립이 공유해서, 서비스를 둘 올려도 같은 파일 쓰기는 차례로 간다 */
const processTails = new Map<string, Promise<unknown>>();

/** 프로세스 안 직렬화만 하는 잠금. 파일 잠금을 받지 못한 조립(시험, 단독 사용)이 쓴다 */
export function createProcessLock(): SecretFileLock {
  const tails = processTails;
  return {
    async withLock<T>(path: string, fn: () => Promise<T>): Promise<Result<T, SecretFileLockError>> {
      const previous = tails.get(path) ?? Promise.resolve();
      const run = previous.then(fn, fn);
      // 뒤따르는 호출은 이 호출이 끝난(성공이든 실패든) 뒤에 시작한다
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(path, tail);
      try {
        return ok(await run);
      } finally {
        if (tails.get(path) === tail) tails.delete(path);
      }
    },
  };
}

/** 잠금 실패를 SecretError로 옮긴다. 취소는 취소로, 나머지는 SOPS 파일 쓰기 실패다 */
export function lockFailure(error: SecretFileLockError, path: string): SecretError {
  switch (error.kind) {
    case "cancelled":
      return { kind: "cancelled" };
    case "timeout":
      return { kind: "write_failed", target: "sops_file", path, code: "lock_timeout" };
    case "io":
      return { kind: "write_failed", target: "sops_file", path, code: error.code };
    default:
      return assertNever(error, "SecretFileLockError");
  }
}
