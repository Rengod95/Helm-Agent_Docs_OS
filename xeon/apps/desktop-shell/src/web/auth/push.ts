// Web Push 구독 저장(spec §6.2). 브라우저의 `PushSubscription.toJSON()`을 검증해 기기에 묶어 둔다: `<remote 폴더>/push-subscriptions.json`(0600).
// 발송은 W2·W3 몫이다. 이 파일은 형식 검증, 저장, 기기 폐기와 함께 지우기까지 맡는다.
// endpoint는 나중에 게이트웨이가 HTTP로 부르는 주소라, https이고 계정 정보가 없고 로컬 주소가 아닌 것만 받는다(내부 망으로 보내는 요청을 막는다).
import { isIP } from "node:net";
import { attempt, err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import { isInteger, isRecord, ownField } from "../../main/lib/narrow.ts";
import { readTextFile, writeSecretFile, type FileError } from "./atomic-file.ts";
import type { AuthPort } from "./auth-port.ts";

export const PUSH_FILE = "push-subscriptions.json";
export const MAX_ENDPOINT_LENGTH = 2048;
/** 기기 하나가 가질 수 있는 구독 수. 넘으면 가장 오래된 것부터 지운다 */
export const MAX_SUBSCRIPTIONS_PER_DEVICE = 10;

export interface PushSubscriptionInput {
  readonly endpoint: string;
  /** 브라우저의 `keys.p256dh`(비압축 점 65바이트의 base64url) */
  readonly p256dh: string;
  /** 브라우저의 `keys.auth`(16바이트의 base64url) */
  readonly auth: string;
}

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  readonly deviceId: string;
  readonly createdAt: number;
}

export type PushSubscriptionError =
  | { readonly kind: "invalid_endpoint" }
  | { readonly kind: "invalid_keys" };

export type PushStoreError =
  | FileError
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string };

export interface PushSubscriptions {
  /** 같은 endpoint가 이미 있으면 덮어쓴다(기기가 바뀌어도 한 endpoint는 한 기기의 것이다) */
  upsert(
    deviceId: string,
    subscription: PushSubscriptionInput,
  ): Result<PushSubscriptionRecord, FileError>;
  /** endpoint로 지운다. 푸시 서비스가 410을 돌려준 구독을 치울 때 쓴다 */
  removeEndpoint(endpoint: string): Result<boolean, FileError>;
  /** 기기의 구독을 모두 지운다. 지운 개수를 돌려준다 */
  removeDevice(deviceId: string): Result<number, FileError>;
  list(): readonly PushSubscriptionRecord[];
  listForDevice(deviceId: string): readonly PushSubscriptionRecord[];
}

function bytesOf(text: string): Buffer | null {
  return /^[A-Za-z0-9_-]+$/u.test(text) ? Buffer.from(text, "base64url") : null;
}

function isForbiddenHostname(hostname: string): boolean {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return (
    isIP(bare) !== 0 ||
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    !bare.includes(".")
  );
}

/** 브라우저가 보낸 구독(`{endpoint, keys: {p256dh, auth}}`)을 검증한다. 경계 값이라 `unknown`으로 받는다 */
export function parsePushSubscription(
  input: unknown,
): Result<PushSubscriptionInput, PushSubscriptionError> {
  if (!isRecord(input)) return err({ kind: "invalid_endpoint" });
  const endpoint = ownField(input, "endpoint");
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return err({ kind: "invalid_endpoint" });
  }
  const url = attempt(() => new URL(endpoint));
  if (
    !url.ok ||
    url.value.protocol !== "https:" ||
    url.value.username !== "" ||
    url.value.password !== "" ||
    isForbiddenHostname(url.value.hostname)
  ) {
    return err({ kind: "invalid_endpoint" });
  }
  const keys = ownField(input, "keys");
  const p256dh = ownField(keys, "p256dh");
  const auth = ownField(keys, "auth");
  if (typeof p256dh !== "string" || typeof auth !== "string") return err({ kind: "invalid_keys" });
  const point = bytesOf(p256dh);
  const secret = bytesOf(auth);
  if (
    point === null ||
    secret === null ||
    point.byteLength !== 65 ||
    point[0] !== 0x04 ||
    secret.byteLength !== 16
  ) {
    return err({ kind: "invalid_keys" });
  }
  return ok({ endpoint, p256dh, auth });
}

function recordOf(value: unknown): PushSubscriptionRecord | null {
  const parsed = parsePushSubscription({
    endpoint: ownField(value, "endpoint"),
    keys: { p256dh: ownField(value, "p256dh"), auth: ownField(value, "auth") },
  });
  const deviceId = ownField(value, "deviceId");
  const createdAt = ownField(value, "createdAt");
  if (!parsed.ok || typeof deviceId !== "string" || !isInteger(createdAt)) return null;
  return { ...parsed.value, deviceId, createdAt };
}

export function openPushSubscriptions(options: {
  readonly dir: string;
  readonly clock: Clock;
}): Result<PushSubscriptions, PushStoreError> {
  const file = `${options.dir}/${PUSH_FILE}`;
  const text = readTextFile(file);
  if (!text.ok) return text;
  let records: PushSubscriptionRecord[] = [];
  if (text.value !== null) {
    const json = parseJson(text.value);
    const list =
      json.ok && isRecord(json.value) && ownField(json.value, "version") === 1
        ? ownField(json.value, "subscriptions")
        : undefined;
    if (!Array.isArray(list)) return err({ kind: "corrupt", path: file, reason: "shape" });
    const loaded: PushSubscriptionRecord[] = [];
    for (const item of list) {
      const record = recordOf(item);
      if (record === null) return err({ kind: "corrupt", path: file, reason: "subscription" });
      loaded.push(record);
    }
    records = loaded;
  }

  function persist(next: PushSubscriptionRecord[]): Result<null, FileError> {
    const written = writeSecretFile(
      file,
      `${JSON.stringify({ version: 1, subscriptions: next }, null, 2)}\n`,
    );
    if (written.ok) records = next;
    return written;
  }

  return ok({
    upsert(deviceId, subscription) {
      const record: PushSubscriptionRecord = {
        ...subscription,
        deviceId,
        createdAt: options.clock.now(),
      };
      const others = records.filter((item) => item.endpoint !== subscription.endpoint);
      const mine = others.filter((item) => item.deviceId === deviceId);
      const dropped = new Set(
        mine
          .slice(0, Math.max(0, mine.length + 1 - MAX_SUBSCRIPTIONS_PER_DEVICE))
          .map((item) => item.endpoint),
      );
      const saved = persist([...others.filter((item) => !dropped.has(item.endpoint)), record]);
      return saved.ok ? ok(record) : saved;
    },

    removeEndpoint(endpoint) {
      const next = records.filter((item) => item.endpoint !== endpoint);
      if (next.length === records.length) return ok(false);
      const saved = persist(next);
      return saved.ok ? ok(true) : saved;
    },

    removeDevice(deviceId) {
      const next = records.filter((item) => item.deviceId !== deviceId);
      const removed = records.length - next.length;
      if (removed === 0) return ok(0);
      const saved = persist(next);
      return saved.ok ? ok(removed) : saved;
    },

    list() {
      return records;
    },

    listForDevice(deviceId) {
      return records.filter((item) => item.deviceId === deviceId);
    },
  });
}

/** 기기가 폐기되면 그 기기의 구독도 지운다. 쓰기 실패는 `onError`로 알린다. 해제 함수를 돌려준다 */
export function removePushOnRevoke(
  auth: AuthPort,
  push: PushSubscriptions,
  onError: (error: FileError) => void,
): () => void {
  return auth.onRevoked((devices) => {
    for (const device of devices) {
      const removed = push.removeDevice(device.id);
      if (!removed.ok) onError(removed.error);
    }
  });
}
