import { ok, type Result } from "@xeon/contracts";
import type { LockAcquireError, LockHandle, LockProvider } from "./provider.ts";

/**
 * OS 잠금이 없는 후퇴안(L0.store.spec §4.7.4). 항상 얻는다. 소유 판정은 sys_leases 행(epoch, 만료,
 * 프로세스 지문)만 한다. Windows(M2 이전)와 FFI 로드 실패 때 쓴다.
 */
export function createNoneLockProvider(): LockProvider {
  return {
    kind: "none",
    tryAcquire(key: string): Result<LockHandle, LockAcquireError> {
      return ok({ key, release: (): void => {} });
    },
  };
}
