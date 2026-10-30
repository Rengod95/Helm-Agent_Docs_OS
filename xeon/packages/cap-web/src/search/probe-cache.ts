import { Bug, attemptAsync, type Clock, type Logger } from "@xeon/contracts";
import type { ProviderAvailabilityWeb } from "@xeon/contracts/capabilities";
import type { ProbeTarget } from "../ports/providers.ts";

// L2.web.spec §4.8.2. 탐침 결과는 provider별로 5분 메모리 캐시한다. 실패 결과는 30초만 둔다.

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

export interface ProbeCache {
  probe(target: ProbeTarget, signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
  /** 설정이 바뀌었을 때(키 등록, 주소 변경) 기억을 지운다 */
  forget(providerId?: string): void;
}

/** provider 코드가 탐침에서 던져도 호출 전체가 거부되지 않게 `unreachable` 실패로 바꾼다. Bug는 그대로 올린다 */
async function probeSafely(
  target: ProbeTarget,
  signal: AbortSignal,
  logger: Logger | undefined,
): Promise<ProviderAvailabilityWeb> {
  const probed = await attemptAsync(() => target.isAvailable(signal));
  if (probed.ok) return probed.value;
  if (probed.error.cause instanceof Bug) throw probed.error.cause;
  logger?.warn("web.probe_threw", { provider: target.id });
  return { ok: false, reason: "unreachable", detail: "probe threw" };
}

export function createProbeCache(clock: Clock, logger?: Logger): ProbeCache {
  const entries = new Map<
    string,
    { readonly result: ProviderAvailabilityWeb; readonly expiresAt: number }
  >();
  const inflight = new Map<string, Promise<ProviderAvailabilityWeb>>();
  return {
    async probe(target, signal) {
      const hit = entries.get(target.id);
      if (hit !== undefined && hit.expiresAt > clock.now()) return hit.result;
      const pending = inflight.get(target.id) ?? probeSafely(target, signal, logger);
      inflight.set(target.id, pending);
      try {
        const result = await pending;
        if (!signal.aborted) {
          entries.set(target.id, {
            result,
            expiresAt: clock.now() + (result.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
          });
        }
        return result;
      } finally {
        inflight.delete(target.id);
      }
    },
    forget(providerId) {
      if (providerId === undefined) entries.clear();
      else entries.delete(providerId);
    },
  };
}
