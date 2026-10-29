import type { Clock, Logger } from "@xeon/contracts";
import type { ProviderOrigin, WebProviderManifest } from "@xeon/contracts/capabilities";
import type { WebStorePort } from "../ports/store.ts";
import { WEB_STORE_OWNER } from "./migrations.ts";

// L2.web.spec §4.8.2. 키 플러그인 첫 사용 고지의 기록. provider마다 한 번만 고지하고, 그 사실을 `cap_web_notices`에 남긴다.
// 저장소 쓰기나 읽기가 실패하면 `web.notice_*` 경고를 한 번 적고, 이 프로세스 동안은 메모리로만 기록한다.

export interface FirstUseNotices {
  /** 처음이면 고지한 것으로 기록하고 true를 돌려준다. 이미 고지했으면 false */
  take(providerId: string): boolean;
  /** 고지한 적이 있는가 */
  has(providerId: string): boolean;
}

/** 고지가 필요한 provider다. 플러그인이고 인증 방식이 `none`이 아니다(§4.8.2) */
export function needsFirstUseNotice(
  origin: ProviderOrigin,
  manifest: WebProviderManifest,
): boolean {
  return origin === "plugin" && manifest.auth.kind !== "none";
}

/**
 * 호출 한 번이 쓴 provider의 고지 경고. 고지가 필요한 provider가 처음 쓰였을 때만 `first_use_notice:<id>`를 돌려준다.
 * 메모에서 꺼낸 결과에는 붙이지 않는다(호출 시점의 경고다).
 */
export function firstUseWarnings(
  notices: FirstUseNotices,
  providerId: string,
  origin: ProviderOrigin,
  manifest: WebProviderManifest,
): readonly string[] {
  if (!needsFirstUseNotice(origin, manifest)) return [];
  return notices.take(providerId) ? [`first_use_notice:${providerId}`] : [];
}

/** 저장소 없이 이 프로세스 안에서만 기억한다 */
export function createMemoryFirstUseNotices(): FirstUseNotices {
  const noticed = new Set<string>();
  return {
    take(providerId) {
      if (noticed.has(providerId)) return false;
      noticed.add(providerId);
      return true;
    },
    has: (providerId) => noticed.has(providerId),
  };
}

export function createFirstUseNotices(deps: {
  readonly store: Pick<WebStorePort, "scoped">;
  readonly clock: Clock;
  readonly logger: Logger;
}): FirstUseNotices {
  const db = (): ReturnType<WebStorePort["scoped"]> => deps.store.scoped(WEB_STORE_OWNER);
  /** 이 프로세스에서 고지한 provider. 저장소를 못 쓰게 되면 이것만 본다 */
  const seen = new Set<string>();
  let degraded = false;

  /** 저장소 실패를 한 번만 기록하고 이 프로세스 동안 메모리로 바꾼다 */
  function fallBack(event: string, kind: string): void {
    if (degraded) return;
    degraded = true;
    deps.logger.warn(event, { kind });
  }

  return {
    take(providerId) {
      if (seen.has(providerId)) return false;
      if (degraded) {
        seen.add(providerId);
        return true;
      }
      const written = db().write(
        (tx) =>
          tx.run("INSERT OR IGNORE INTO cap_web_notices (provider, noticed_at) VALUES (?, ?)", [
            providerId,
            deps.clock.now(),
          ]).changes,
      );
      seen.add(providerId);
      if (!written.ok) {
        fallBack("web.notice_write_failed", written.error.kind);
        return true;
      }
      return written.value > 0;
    },
    has(providerId) {
      if (seen.has(providerId)) return true;
      if (degraded) return false;
      const read = db().read((tx) =>
        tx.get("SELECT provider FROM cap_web_notices WHERE provider = ?", [providerId]),
      );
      if (!read.ok) {
        fallBack("web.notice_read_failed", read.error.kind);
        return false;
      }
      return read.value !== undefined;
    },
  };
}
