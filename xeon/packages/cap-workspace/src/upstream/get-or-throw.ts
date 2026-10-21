import type { Result } from "@xeon/contracts";

/**
 * 포크 본문이 쓰는 `getOrThrow`. 원본은 `env/index.ts`가 내보내지만 이 패키지는 구현 패키지를 import하지 않으므로
 * F `Result` 위에 같은 동작을 둔다. 실패 값(`FileError`, `ExecutionError`)을 그대로 던지고, 서비스 경계(`errors.ts`)가 받는다.
 */
export function getOrThrow<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}
