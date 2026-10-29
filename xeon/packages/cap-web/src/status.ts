import { attemptAsync } from "@xeon/contracts";
import type {
  ProviderAvailabilityWeb,
  ProviderCandidate,
  ProviderOrigin,
  WebProviderManifest,
} from "@xeon/contracts/capabilities";
import type {
  WebProviderCapability,
  WebProviderStatus,
  WebProvidersResult,
} from "@xeon/contracts/wire";
import { needsFirstUseNotice } from "./cache/notices.ts";
import type { WebDeps } from "./deps.ts";
import { isPricingStale } from "./cost/pricing.ts";
import type { ProbeTarget } from "./ports/providers.ts";
import { planSelection } from "./select/order.ts";
import type { WebSettings } from "./settings.ts";

// L2.web.spec §6.1, F.wire-settings(`web.providers`). 카탈로그, 탐침 캐시, 고지 기록에서 wire 행을 만든다.
// 읽기 전용이다. 키 값, 주입 위치, 헤더 이름은 행에 싣지 않는다(provider가 돌려준 탐침 사유만 옮긴다).
// 탐침이 예외로 끝나면 그 provider 한 행만 `unreachable`로 적고, 나머지 행은 그대로 돌려준다.

/** 행 하나를 만드는 입력. 세 능력의 후보를 같은 모양으로 맞춘다 */
interface StatusSource {
  readonly capability: WebProviderCapability;
  readonly origin: ProviderOrigin;
  readonly provider: ProbeTarget;
  /** 자동 선택 순서의 자리. fetch 행은 사용자 순서가 없어서 null이다 */
  readonly autoRank: number | null;
}

/** 가격표 단위 가운데 값이 0보다 큰 것이 있는가. 없으면 무료 provider로 보고 기준일을 싣지 않는다 */
function isPriced(manifest: WebProviderManifest): boolean {
  return Object.values(manifest.pricing.units).some((price) => price > 0);
}

/** 탐침이 돌려준 가용성을 행의 상태로 옮긴다. `detail`은 200자에서 자른다 */
function statusOf(availability: ProviderAvailabilityWeb): WebProviderStatus["status"] {
  if (availability.ok) return { kind: "ok" };
  const { reason, detail } = availability;
  return {
    kind: "unavailable",
    reason,
    ...(detail === undefined ? {} : { detail: detail.slice(0, 200) }),
  };
}

async function describeOne(
  deps: WebDeps,
  source: StatusSource,
  signal: AbortSignal,
): Promise<WebProviderStatus> {
  const { capability, origin, provider, autoRank } = source;
  const manifest = provider.manifest;
  // 탐침(`isAvailable`)은 provider 코드라 던질 수 있다. 던지면 이 행만 `unreachable`이고 원인은 Logger에 남긴다(TY-25)
  const probed = await attemptAsync(() => deps.probes.probe(provider, signal));
  if (!probed.ok) deps.logger.warn("web.probe_threw", { provider: provider.id });
  const pricingAsOf = isPriced(manifest) ? manifest.pricing.asOf : null;
  return {
    id: provider.id,
    capability,
    origin,
    displayName: manifest.displayName,
    auth: manifest.auth.kind,
    status: probed.ok
      ? statusOf(probed.value)
      : { kind: "unavailable", reason: "unreachable", detail: "probe threw" },
    pricingAsOf,
    pricingStale: pricingAsOf !== null && isPricingStale(pricingAsOf, deps.clock.now()),
    firstUseNoticed: needsFirstUseNotice(origin, manifest) ? deps.notices.has(provider.id) : true,
    autoRank,
  };
}

/**
 * `auto` 선택이 시도하는 순서에서 후보마다의 0부터 센 자리다. 설정 provider나 탐침 결과와 무관하다(select/order.ts의 `planSelection`).
 * 목록에 없는 후보는 `planSelection`이 뒤에 붙이므로 모든 후보가 자리를 얻는다.
 */
function autoRanks(
  candidates: readonly ProviderCandidate[],
  order: readonly string[],
): ReadonlyMap<string, number> {
  const plan = planSelection({ candidates, settingProvider: "auto", order });
  return new Map(plan.order.map((id, index): [string, number] => [id, index]));
}

/**
 * 검색, fetch, 브라우저 후보마다 한 행이다. 탐침은 provider마다 동시에 돈다(탐침 캐시를 거친다), 그래서 느린 provider 하나가
 * 나머지를 막지 않는다.
 */
export async function describeWebProviders(
  deps: WebDeps,
  signal: AbortSignal,
): Promise<readonly WebProviderStatus[]> {
  const settings = deps.settings(undefined);
  const searchCandidates = deps.catalog.searchCandidates();
  const fetchCandidates = deps.catalog.fetchCandidates();
  const browseCandidates = deps.catalog.browseCandidates();
  const searchRanks = autoRanks(
    searchCandidates.map((candidate) => ({ id: candidate.provider.id, origin: candidate.origin })),
    settings.search.order,
  );
  const browseRanks = autoRanks(
    browseCandidates.map((candidate) => ({ id: candidate.provider.id, origin: candidate.origin })),
    settings.browse.order,
  );
  const sources: readonly StatusSource[] = [
    ...searchCandidates.map((candidate): StatusSource => ({
      capability: "web.search",
      origin: candidate.origin,
      provider: candidate.provider,
      autoRank: searchRanks.get(candidate.provider.id) ?? null,
    })),
    ...fetchCandidates.map((candidate): StatusSource => ({
      capability: "web.fetch",
      origin: candidate.origin,
      provider: candidate.provider,
      autoRank: null,
    })),
    ...browseCandidates.map((candidate): StatusSource => ({
      capability: "web.browse",
      origin: candidate.origin,
      provider: candidate.provider,
      autoRank: browseRanks.get(candidate.provider.id) ?? null,
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
