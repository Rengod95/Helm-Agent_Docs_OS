// 웹 푸시 등록(§6.2). 서비스 워커를 등록하고, 서버의 VAPID 공개 키로 구독한 뒤 구독을 서버에 준다.
// 안전한 문맥(HTTPS 또는 localhost)에서만 하고, 실패는 거절 값으로 낸다. 페이지를 읽을 때 던지지 않는다.
import type { ShimFetch, ShimResponse, ShimServiceWorkers } from "./env.ts";
import { attempt, attemptAsync, detach, ownField, refuse } from "./util.ts";

export const SERVICE_WORKER_PATH = "/sw.js";
export const VAPID_KEY_PATH = "/push/vapid-key";
export const PUSH_SUBSCRIBE_PATH = "/push/subscribe";
/** 비압축 P-256 점 하나: 0x04와 x, y 좌표 32바이트씩 */
const VAPID_KEY_BYTES = 65;

/** 실패 종류. 거절 값은 `{kind}`다 */
type PushFailureKind =
  | "insecure"
  | "unsupported"
  | "register"
  | "vapid-key"
  | "subscribe"
  | "store";

/** 실패 종류를 거절 값 `{kind}`로 낸다 */
function failed(kind: PushFailureKind): Promise<never> {
  return refuse({ kind });
}

export interface PushDeps {
  readonly isSecureContext: boolean;
  readonly serviceWorkers: ShimServiceWorkers | undefined;
  readonly fetch: ShimFetch;
}

/** base64url 글을 바이트로. 형식이 틀리거나 P-256 비압축 점 길이가 아니면 `null` */
function base64UrlBytesOf(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) return null;
  const base64 = text.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = attempt(() => atob(padded));
  if (!binary.ok) return null;
  const bytes = new Uint8Array(binary.value.length);
  for (let i = 0; i < binary.value.length; i += 1) {
    bytes[i] = binary.value.charCodeAt(i);
  }
  return bytes.byteLength === VAPID_KEY_BYTES ? bytes : null;
}

async function publicKeyOf(response: ShimResponse): Promise<Uint8Array<ArrayBuffer> | null> {
  const json = await attemptAsync(() => response.json());
  if (!json.ok) return null;
  const text = ownField(json.value, "publicKey");
  return typeof text === "string" ? base64UrlBytesOf(text) : null;
}

/**
 * 푸시를 켠다. 성공이면 `null`로 끝나고, 실패면 `{kind}`로 거절한다.
 * 순서: 서비스 워커 등록, 공개 키 받기, 활성 워커의 구독, 구독을 서버에 저장(POST).
 */
export async function enablePush(deps: PushDeps): Promise<null> {
  if (!deps.isSecureContext) return failed("insecure");
  const workers = deps.serviceWorkers;
  if (workers === undefined) return failed("unsupported");
  const registered = await attemptAsync(() => workers.register(SERVICE_WORKER_PATH));
  if (!registered.ok) return failed("register");
  const keyReply = await attemptAsync(() => deps.fetch(VAPID_KEY_PATH, { credentials: "include" }));
  if (!keyReply.ok || !keyReply.value.ok) return failed("vapid-key");
  const publicKey = await publicKeyOf(keyReply.value);
  if (publicKey === null) return failed("vapid-key");
  const manager = await attemptAsync(() => workers.activePushManager());
  if (!manager.ok) return failed("subscribe");
  const subscription = await attemptAsync(() =>
    manager.value.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }),
  );
  if (!subscription.ok) return failed("subscribe");
  const body = attempt(() => JSON.stringify(subscription.value.toJSON()));
  if (!body.ok) return failed("subscribe");
  const posted = await attemptAsync(() =>
    deps.fetch(PUSH_SUBSCRIBE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body.value,
      credentials: "include",
    }),
  );
  if (!posted.ok || !posted.value.ok) return failed("store");
  return null;
}

export interface PushRunnerDeps extends PushDeps {
  /** 실패를 페이지에 알린다(진단 코드만) */
  readonly report: (code: string) => void;
}

/**
 * 푸시 등록을 한 페이지 안에서 한 번만 돌리는 함수를 만든다. 푸시를 쓸 수 없는 문맥이면 아무 일도 하지 않는다.
 * 등록이 실패하면 거절을 `report`로 알리고, 호출자에게 거절을 넘기지 않는다.
 */
export function createPushRunner(deps: PushRunnerDeps): () => void {
  let run: Promise<null> | null = null;
  return () => {
    if (!deps.isSecureContext || deps.serviceWorkers === undefined) return;
    if (run !== null) return;
    run = enablePush({
      isSecureContext: deps.isSecureContext,
      serviceWorkers: deps.serviceWorkers,
      fetch: deps.fetch,
    });
    detach(run, () => {
      deps.report("push-failed");
    });
  };
}
