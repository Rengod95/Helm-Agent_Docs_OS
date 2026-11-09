// Web Push 발송(spec §6.2). 구독마다 페이로드를 `aes128gcm`으로 암호화하고 푸시 서비스 주소로 POST한다.
// 응답 처리: 2xx 성공, 404·410은 구독을 지운다(푸시 서비스가 더 쓰지 않겠다는 뜻), 429·5xx는 `Retry-After`만큼 기다려 한 번 더 보내고 그래도 안 되면 포기한다,
// 그 밖의 4xx는 아무것도 지우지 않고 보고만 한다. 로그에는 호스트와 상태만 남긴다(페이로드, 키, 토큰 값은 남기지 않는다).
import {
  assertNever,
  attempt,
  attemptAsync,
  detach,
  err,
  ok,
  type Clock,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import type { PushSubscriptionRecord, PushSubscriptions } from "../auth/push.ts";
import type { VapidKeyring } from "../auth/vapid.ts";
import { encryptPayload } from "./encrypt.ts";

/** 알림 제목의 글자(코드 포인트) 상한. 넘는 부분은 자른다 */
export const PUSH_TITLE_MAX_CHARS = 120;
/** `TTL` 헤더(초). 24시간이면 푸시 서비스가 보관하는 최대 시간이다 */
const PUSH_TTL_SECONDS = 86_400;
/** VAPID JWT 수명(초). 24시간 상한 안에서 시계 차이에 여유를 둔다 */
const VAPID_JWT_LIFETIME_SECONDS = 43_200;
/** 요청 하나의 시간 상한 */
const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** `Retry-After`의 상한. 넘는 값은 이만큼만 기다린다 */
export const RETRY_AFTER_CAP_MS = 30_000;
/** `Retry-After`가 없거나 읽을 수 없을 때 기다리는 시간 */
export const DEFAULT_RETRY_AFTER_MS = 1_000;

/** 푸시로 보내는 내용. 제목과 대화 식별자뿐이다(본문과 시크릿 값은 싣지 않는다, spec §6.2) */
export interface PushPayload {
  readonly title: string;
  readonly threadId: string | null;
}

/** 구독 한 건에 대한 결과. `host`는 endpoint의 호스트뿐이라 경로와 토큰이 들어가지 않는다 */
type DeliveryOutcome =
  | "delivered"
  | "removed"
  | "removal_failed"
  | "rejected"
  | "gave_up"
  | "network_failed"
  | "sign_failed"
  | "encrypt_failed";

interface DeliveryAttempt {
  readonly deviceId: string;
  readonly host: string;
  readonly outcome: DeliveryOutcome;
  /** 마지막으로 받은 HTTP 상태. 응답이 없었으면 null */
  readonly status: number | null;
}

export interface SendReport {
  readonly delivered: number;
  /** 404·410으로 구독을 지운 수 */
  readonly removed: number;
  /** 성공도 지움도 아닌 것: 거절, 포기, 네트워크 오류, 서명·암호화 실패, 지우기 실패 */
  readonly failed: number;
  readonly attempts: readonly DeliveryAttempt[];
}

export interface PushSender {
  /** 저장된 구독 모두에게(또는 `deviceId`의 구독에게) 보낸다. 개별 실패는 보고서에 담기고 함수 자체는 실패하지 않는다 */
  send(payload: PushPayload, options?: { readonly deviceId?: string }): Promise<SendReport>;
}

/** 푸시 서비스로 가는 요청 함수. 운영은 전역 `fetch`를, 시험은 가짜를 넣는다 */
export type PushFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface PushSenderDeps {
  readonly keyring: VapidKeyring;
  readonly subscriptions: PushSubscriptions;
  readonly fetch: PushFetch;
  /** VAPID `sub`: `mailto:` 또는 `https://` 연락처 */
  readonly subject: string;
  readonly clock: Clock;
  readonly logger: Logger;
  /** 재시도 전 대기. 시험은 기록만 하는 대역을 넣는다. 기본은 실제 타이머다 */
  readonly sleep?: (ms: number) => Promise<void>;
}

type Status = "delivered" | "gone" | "retry" | "rejected";

function statusKindOf(status: number): Status {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || (status >= 500 && status < 600)) return "retry";
  return "rejected";
}

/** `Retry-After`를 밀리초로 바꾼다. 초(정수)나 HTTP 날짜를 받고, 상한을 넘으면 자른다 */
export function retryDelayMs(value: string | null, nowMs: number): number {
  if (value === null) return DEFAULT_RETRY_AFTER_MS;
  const text = value.trim();
  const ms = /^\d+$/u.test(text) ? Number(text) * 1000 : Date.parse(text) - nowMs;
  if (!Number.isFinite(ms)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}

function hostOf(endpoint: string): string {
  const url = attempt(() => new URL(endpoint));
  return url.ok ? url.value.host : "unparsable";
}

/** 제목을 코드 포인트 기준으로 자르고 `{"title":…,"threadId":…}` JSON 바이트로 만든다 */
function plaintextOf(payload: PushPayload): Uint8Array<ArrayBuffer> {
  const title = Array.from(payload.title).slice(0, PUSH_TITLE_MAX_CHARS).join("");
  return new TextEncoder().encode(JSON.stringify({ title, threadId: payload.threadId }));
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type SendFailure = "sign_failed" | "network_failed";

function attemptOf(
  record: PushSubscriptionRecord,
  outcome: DeliveryOutcome,
  status: number | null,
): DeliveryAttempt {
  return { deviceId: record.deviceId, host: hostOf(record.endpoint), outcome, status };
}

export function createPushSender(deps: PushSenderDeps): PushSender {
  const sleep = deps.sleep ?? defaultSleep;

  /** 한 번 보낸다. 서명 실패와 네트워크 오류만 `err`다. HTTP 상태는 응답 그대로 본다 */
  async function post(
    endpoint: string,
    body: Uint8Array<ArrayBuffer>,
  ): Promise<Result<Response, SendFailure>> {
    const authorization = deps.keyring.authorizationHeader({
      endpoint,
      subject: deps.subject,
      ttlSeconds: VAPID_JWT_LIFETIME_SECONDS,
    });
    if (!authorization.ok) return err("sign_failed");
    const sent = await attemptAsync(() =>
      deps.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(PUSH_TTL_SECONDS),
          Urgency: "normal",
          Authorization: authorization.value,
        },
        body,
        signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
      }),
    );
    return sent.ok ? ok(sent.value) : err("network_failed");
  }

  /** 404·410 뒤처리: 구독을 endpoint로 지운다 */
  function removeGone(record: PushSubscriptionRecord, status: number): DeliveryAttempt {
    const host = hostOf(record.endpoint);
    const removed = deps.subscriptions.removeEndpoint(record.endpoint);
    if (!removed.ok) {
      deps.logger.warn("push.removal_failed", { host, status, op: removed.error.op });
      return { deviceId: record.deviceId, host, outcome: "removal_failed", status };
    }
    deps.logger.info("push.removed", { host, status });
    return { deviceId: record.deviceId, host, outcome: "removed", status };
  }

  /** 응답 상태를 결과로 바꾼다. 재시도는 이미 끝났다 */
  function settle(record: PushSubscriptionRecord, status: number): DeliveryAttempt {
    const host = hostOf(record.endpoint);
    const kind = statusKindOf(status);
    switch (kind) {
      case "delivered":
        deps.logger.info("push.delivered", { host, status });
        return attemptOf(record, "delivered", status);
      case "gone":
        return removeGone(record, status);
      case "retry":
        deps.logger.warn("push.gave_up", { host, status });
        return attemptOf(record, "gave_up", status);
      case "rejected":
        deps.logger.warn("push.rejected", { host, status });
        return attemptOf(record, "rejected", status);
      default:
        return assertNever(kind, "push sender settle");
    }
  }

  function failed(record: PushSubscriptionRecord, reason: SendFailure): DeliveryAttempt {
    const host = hostOf(record.endpoint);
    if (reason === "sign_failed") {
      deps.logger.error("push.sign_failed", { host });
      return attemptOf(record, "sign_failed", null);
    }
    deps.logger.warn("push.network_failed", { host });
    return attemptOf(record, "network_failed", null);
  }

  async function deliver(
    record: PushSubscriptionRecord,
    plaintext: Uint8Array<ArrayBuffer>,
  ): Promise<DeliveryAttempt> {
    const encrypted = encryptPayload({ plaintext, p256dh: record.p256dh, auth: record.auth });
    if (!encrypted.ok) {
      deps.logger.error("push.encrypt_failed", {
        host: hostOf(record.endpoint),
        reason: encrypted.error.kind,
      });
      return attemptOf(record, "encrypt_failed", null);
    }
    const first = await post(record.endpoint, encrypted.value);
    if (!first.ok) return failed(record, first.error);
    const firstStatus = first.value.status;
    release(record, first.value);
    if (statusKindOf(firstStatus) !== "retry") return settle(record, firstStatus);

    const host = hostOf(record.endpoint);
    deps.logger.info("push.retry_scheduled", { host, status: firstStatus });
    await sleep(retryDelayMs(first.value.headers.get("Retry-After"), deps.clock.now()));
    const second = await post(record.endpoint, encrypted.value);
    if (!second.ok) return failed(record, second.error);
    const secondStatus = second.value.status;
    release(record, second.value);
    return settle(record, secondStatus);
  }

  /** 응답 본문은 쓰지 않는다. 연결을 놓아 주기 위해 취소하고, 취소 실패는 디버그 기록만 남긴다 */
  function release(record: PushSubscriptionRecord, response: Response): void {
    detach(response.body?.cancel() ?? Promise.resolve(), () => {
      deps.logger.debug("push.body_release_failed", { host: hostOf(record.endpoint) });
    });
  }

  return {
    async send(payload, options) {
      const records =
        options?.deviceId === undefined
          ? deps.subscriptions.list()
          : deps.subscriptions.listForDevice(options.deviceId);
      const plaintext = plaintextOf(payload);
      const attempts = await Promise.all(records.map((record) => deliver(record, plaintext)));
      return {
        delivered: attempts.filter((item) => item.outcome === "delivered").length,
        removed: attempts.filter((item) => item.outcome === "removed").length,
        failed: attempts.filter(
          (item) => item.outcome !== "delivered" && item.outcome !== "removed",
        ).length,
        attempts,
      };
    },
  };
}
