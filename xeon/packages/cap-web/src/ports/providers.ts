import type {
  ProviderAvailabilityWeb,
  ProviderOrigin,
  WebFetchProvider,
  WebProviderManifest,
  WebSearchProvider,
} from "@xeon/contracts/capabilities";

// 능력별 provider 후보(L2.web.spec §3.6.1 2번, §4.8.2). 후보 등록·조회는 X가 정한다 [가정: X.primitives]. cap-web은 이 모양만 안다.
// 내장 provider(searxng, builtin-wrapper, local)와 플러그인 provider를 같은 목록에서 받는다.

export interface SearchCandidate {
  readonly provider: WebSearchProvider;
  readonly origin: ProviderOrigin;
  /** 매니페스트 `cachePolicy`를 검토 여부까지 반영해 낮춘 값(§4.3.2) */
  readonly cachePolicy: "none" | "session" | "persist";
}

export interface FetchCandidate {
  readonly provider: WebFetchProvider;
  readonly origin: ProviderOrigin;
  readonly cachePolicy: "none" | "session" | "persist";
}

export interface WebProviderCatalog {
  searchCandidates(): readonly SearchCandidate[];
  fetchCandidates(): readonly FetchCandidate[];
}

/** 탐침을 짧게 기억하는 도우미가 쓰는 모양 */
export interface ProbeTarget {
  readonly id: string;
  readonly manifest: WebProviderManifest;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
}
