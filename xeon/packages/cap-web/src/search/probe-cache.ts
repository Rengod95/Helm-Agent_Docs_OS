import type { Clock } from "@xeon/contracts";
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

export function createProbeCache(clock: Clock): ProbeCache {
  const entries = new Map<
    string,
    { readonly result: ProviderAvailabilityWeb; readonly expiresAt: number }
  >();
  const inflight = new Map<string, Promise<ProviderAvailabilityWeb>>();
  return {
    async probe(target, signal) {
      const hit = entries.get(target.id);
      if (hit !== undefined && hit.expiresAt > clock.now()) return hit.result;
      const pending = inflight.get(target.id) ?? target.isAvailable(signal);
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
