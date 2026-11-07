import type { FetchFunction } from "@earendil-works/pi-ai";
import { attempt, type Clock, type Logger } from "@fresnel/contracts";
import type { ModelRetryEvent } from "@fresnel/contracts/services";

// L1.models.spec §4.5 재시도 상태 이벤트와 retry-after 표지. pi-ai는 maxRetries만큼 같은 요청을 다시 보내지만 재시도
// 콜백이 없다. 요청 옵션 fetch로 감싼 fetch가 응답마다 상태를 보고, pi-ai가 다시 보낼 것이 확실할 때만 onRetry를 부른다.
// 재시도 조건(상태 코드, x-should-retry, 서버 대기 상한)은 pi-ai utils/provider-retry.js와 같다.

/**
 * options.fetch를 받고 retryProviderRequest로 다시 보내는 pi-ai 어댑터. google-*은 custom fetch를 거부하고,
 * mistral·pi-messages는 다시 보내지 않으므로 여기에 넣지 않는다(다시 보내지 않는 호출에 재시도 이벤트를 내지 않는다).
 */
export const RETRYING_FETCH_APIS: ReadonlySet<string> = new Set([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
]);

interface RetryFetchOptions {
  readonly base: FetchFunction;
  readonly clock: Clock;
  /** pi-ai에 넘기는 재시도 횟수. 재시도가 꺼진 호출은 0 */
  readonly maxRetries: number;
  /** 서버가 준 대기가 이 값을 넘으면 pi-ai는 다시 보내지 않고 오류로 끝낸다. 0이면 상한이 없다 */
  readonly maxDelayMs: number;
  readonly signal?: AbortSignal;
  readonly onRetry?: (event: ModelRetryEvent) => void;
  readonly logger?: Logger;
}

/** 마지막 시도의 결과. 네트워크 예외로 끝났으면 status가 null */
export interface LastAttempt {
  readonly status: number | null;
  /** retry-after-ms 또는 retry-after로 읽은 서버 대기(ms). 헤더가 없으면 null */
  readonly serverDelayMs: number | null;
}

export interface RetryFetch {
  readonly fetch: FetchFunction;
  /** 시도가 한 번도 없었으면 null */
  last(): LastAttempt | null;
}

/** pi-ai의 지수 추정값(지터 없음). retryNo는 1부터 센 재시도 번호 */
function exponentialDelayMs(retryNo: number): number {
  return Math.min(0.5 * 2 ** (retryNo - 1), 8) * 1000;
}

/** pi-ai와 같은 순서로 서버 대기를 읽는다: retry-after-ms, 그다음 retry-after(초 또는 HTTP 날짜) */
function serverDelayOf(headers: Headers, now: number): number | null {
  const ms = Number.parseFloat(headers.get("retry-after-ms") ?? "");
  if (Number.isFinite(ms)) return Math.max(0, ms);
  const after = headers.get("retry-after") ?? "";
  const seconds = Number.parseFloat(after);
  const delay = Number.isNaN(seconds) ? Date.parse(after) - now : seconds * 1000;
  return Number.isFinite(delay) ? Math.max(0, delay) : null;
}

function retryableStatus(status: number, headers: Headers): boolean {
  const flag = headers.get("x-should-retry");
  if (flag === "true") return true;
  if (flag === "false") return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** 요청 하나(startOnce 호출 하나)마다 따로 만든다. 시도 횟수와 마지막 결과가 그 요청의 것이다 */
export function createRetryFetch(options: RetryFetchOptions): RetryFetch {
  let sent = 0;
  let last: LastAttempt | null = null;

  /** 방금 실패한 시도 뒤에 pi-ai가 다시 보내는 것이 확실할 때만 onRetry를 부른다 */
  function noteRetry(serverDelayMs: number | null): void {
    // 이 시도가 일으킬 재시도 번호. 재시도 한도를 넘었으면 pi-ai는 오류로 끝낸다
    const attemptNo = sent;
    if (attemptNo > options.maxRetries) return;
    if (options.signal?.aborted === true) return;
    if (serverDelayMs !== null && options.maxDelayMs > 0 && serverDelayMs > options.maxDelayMs) {
      return;
    }
    const event: ModelRetryEvent = {
      attempt: attemptNo,
      maxRetries: options.maxRetries,
      waitMs: serverDelayMs ?? exponentialDelayMs(attemptNo),
    };
    const onRetry = options.onRetry;
    if (onRetry === undefined) return;
    // 재시도 알림이 던져도 요청은 이어진다
    const notified = attempt(() => {
      onRetry(event);
    });
    if (!notified.ok) options.logger?.warn("model.retry_listener_failed", { attempt: attemptNo });
  }

  async function send(
    input: Parameters<FetchFunction>[0],
    init?: Parameters<FetchFunction>[1],
  ): Promise<Response> {
    sent += 1;
    let response: Response;
    try {
      response = await options.base(input, init);
    } catch (error) {
      // 상태 없는 예외(연결 실패, 시간 초과)는 pi-ai가 재시도 대상으로 본다
      last = { status: null, serverDelayMs: null };
      noteRetry(null);
      throw error;
    }
    const serverDelayMs = serverDelayOf(response.headers, options.clock.now());
    last = { status: response.status, serverDelayMs };
    if (retryableStatus(response.status, response.headers)) noteRetry(serverDelayMs);
    return response;
  }

  return {
    fetch: Object.assign(send, { preconnect: options.base.preconnect }),
    last: () => last,
  };
}
