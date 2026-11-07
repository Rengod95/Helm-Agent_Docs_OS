import type { ProviderRetry } from "../state/engine/index.ts";

// 제공자 재시도 대기 상태 줄(L4 desktop-ux 입력창 상태 줄)의 값. 화면 없이 시험한다. 시각은 호출자가 준다.

/** 남은 초. `at + waitMs`까지 남은 시간을 올림해 센다. 이미 지났으면 0이다 */
export function retrySecondsLeft(retry: Pick<ProviderRetry, "at" | "waitMs">, now: number): number {
  return Math.max(0, Math.ceil((retry.at + retry.waitMs - now) / 1000));
}

/** 상태 줄에 넣을 값. 남은 초가 0이면 "곧"(soon)이다 */
export type RetryLine =
  | { readonly soon: true; readonly attempt: number; readonly max: number }
  | {
      readonly soon: false;
      readonly attempt: number;
      readonly max: number;
      readonly seconds: number;
    };

/** 상태 줄의 문구 값. 재시도 번호는 1부터 센다(`attempt`/`max`) */
export function retryLineOf(retry: ProviderRetry, now: number): RetryLine {
  const seconds = retrySecondsLeft(retry, now);
  const base = { attempt: retry.attempt, max: retry.maxRetries };
  return seconds === 0 ? { soon: true, ...base } : { soon: false, ...base, seconds };
}
