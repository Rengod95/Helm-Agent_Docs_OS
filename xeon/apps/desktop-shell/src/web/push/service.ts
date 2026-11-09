// `PushService`(서버 포트, `src/web/server/ports.ts`)의 구현. 공개 키를 알려 주고, 브라우저의 구독을 검증해 기기에 묶어 저장한다.
// 저장 실패의 원인(파일 경로, 시스템 오류)은 서버 쪽으로 넘기지 않고 `store_failed` 한 종류로 줄인다.
import { err, ok, type Result } from "@fresnel/contracts";
import type { PushSubscribeError, PushService } from "../server/ports.ts";
import { parsePushSubscription, type PushSubscriptions } from "../auth/push.ts";
import type { VapidKeyring } from "../auth/vapid.ts";

export function createPushService(deps: {
  readonly keyring: VapidKeyring;
  readonly subscriptions: PushSubscriptions;
}): PushService {
  return {
    vapidPublicKey(): string {
      return deps.keyring.publicKey;
    },

    subscribe(deviceId: string, body: unknown): Result<null, PushSubscribeError> {
      const parsed = parsePushSubscription(body);
      if (!parsed.ok) return err({ kind: parsed.error.kind });
      const saved = deps.subscriptions.upsert(deviceId, parsed.value);
      if (!saved.ok) return err({ kind: "store_failed" });
      return ok(null);
    },
  };
}
