import type { ProviderOrigin, WebProviderManifest } from "@xeon/contracts/capabilities";
import type {
  WebProviderCapability,
  WebProviderStatus,
  WebProvidersResult,
} from "@xeon/contracts/wire";
import { needsFirstUseNotice } from "./cache/notices.ts";
import type { WebDeps } from "./deps.ts";
import { isPricingStale } from "./cost/pricing.ts";
import type { ProbeTarget } from "./ports/providers.ts";
import type { WebSettings } from "./settings.ts";

// L2.web.spec §6.1, F.wire-settings(`web.providers`). 카탈로그, 탐침 캐시, 고지 기록에서 wire 행을 만든다.
// 읽기 전용이다. 키 값, 주입 위치, 헤더 이름은 행에 싣지 않는다(provider가 돌려준 탐침 사유만 옮긴다).

/** 행 하나를 만드는 입력. 세 능력의 후보를 같은 모양으로 맞춘다 */
interface StatusSource {
  readonly capability: WebProviderCapability;
  readonly origin: ProviderOrigin;
  readonly provider: ProbeTarget;
}

/** 가격표 단위 가운데 값이 0보다 큰 것이 있는가. 없으면 무료 provider로 보고 기준일을 싣지 않는다 */
function isPriced(manifest: WebProviderManifest): boolean {
  return Object.values(manifest.pricing.units).some((price) => price > 0);
}

async function describeOne(
  deps: WebDeps,
  source: StatusSource,
  signal: AbortSignal,
): Promise<WebProviderStatus> {
  const { capability, origin, provider } = source;
  const manifest = provider.manifest;
  const probed = await deps.probes.probe(provider, signal);
  const pricingAsOf = isPriced(manifest) ? manifest.pricing.asOf : null;
  return {
    id: provider.id,
    capability,
    origin,
    displayName: manifest.displayName,
    auth: manifest.auth.kind,
    status: probed.ok
      ? { kind: "ok" }
      : {
          kind: "unavailable",
          reason: probed.reason,
          ...(probed.detail === undefined ? {} : { detail: probed.detail.slice(0, 512) }),
        },
    pricingAsOf,
    pricingStale: pricingAsOf !== null && isPricingStale(pricingAsOf, deps.clock.now()),
    firstUseNoticed: needsFirstUseNotice(origin, manifest) ? deps.notices.has(provider.id) : true,
  };
}

/**
 * 검색, fetch, 브라우저 후보마다 한 행이다. 탐침은 provider마다 동시에 돈다(탐침 캐시를 거친다), 그래서 느린 provider 하나가
 * 나머지를 막지 않는다.
 */
export async function describeWebProviders(
  deps: WebDeps,
  signal: AbortSignal,
): Promise<readonly WebProviderStatus[]> {
  const sources: readonly StatusSource[] = [
    ...deps.catalog.searchCandidates().map((candidate): StatusSource => ({
      capability: "web.search",
      origin: candidate.origin,
      provider: candidate.provider,
    })),
    ...deps.catalog.fetchCandidates().map((candidate): StatusSource => ({
      capability: "web.fetch",
      origin: candidate.origin,
      provider: candidate.provider,
    })),
    ...deps.catalog.browseCandidates().map((candidate): StatusSource => ({
      capability: "web.browse",
      origin: candidate.origin,
      provider: candidate.provider,
    })),
  ];
  return Promise.all(sources.map((source) => describeOne(deps, source, signal)));
}

/** 웹 설정의 유효 값을 wire 모양으로 바꾼다. 목록은 64개, 문자열은 96자 상한에 맞춘다 */
export function describeWebSettings(settings: WebSettings): WebProvidersResult["settings"] {
  return {
    searchProvider: settings.search.provider.slice(0, 96),
    searchOrder: settings.search.order.slice(0, 64).map((id) => id.slice(0, 96)),
    searchParallel: Math.min(4, Math.max(1, settings.search.parallel)),
    browseProvider: settings.browse.provider.slice(0, 96),
    browseOrder: settings.browse.order.slice(0, 64).map((id) => id.slice(0, 96)),
    robots: settings.policy.robots,
  };
}
