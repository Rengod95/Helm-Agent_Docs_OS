import type {
  ProviderAvailabilityWeb,
  ProviderOrigin,
  WebBrowseProvider,
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
  /**
   * 지금 체인에 들어가는가. 호출마다 읽는다. 없으면 항상 들어간다. 사용자가 설정하지 않은 내장 provider(주소를 정하지 않은
   * SearXNG)를 후보에서 빼는 데 쓴다(L2.web.spec §4.8.2, 자동 감지 없음)
   */
  readonly enabled?: () => boolean;
}

export interface FetchCandidate {
  readonly provider: WebFetchProvider;
  readonly origin: ProviderOrigin;
  readonly cachePolicy: "none" | "session" | "persist";
}

export interface BrowseCandidate {
  readonly provider: WebBrowseProvider;
  readonly origin: ProviderOrigin;
  readonly cachePolicy: "none" | "session" | "persist";
}

export interface WebProviderCatalog {
  searchCandidates(): readonly SearchCandidate[];
  fetchCandidates(): readonly FetchCandidate[];
  browseCandidates(): readonly BrowseCandidate[];
}

/** 탐침을 짧게 기억하는 도우미가 쓰는 모양 */
export interface ProbeTarget {
  readonly id: string;
  readonly manifest: WebProviderManifest;
  isAvailable(signal: AbortSignal): Promise<ProviderAvailabilityWeb>;
}
