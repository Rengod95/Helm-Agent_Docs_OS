import type { Clock, Logger } from "@xeon/contracts";
import type { HostedSearchPort } from "@xeon/contracts/services";
import type { ProviderHttpDeps } from "../../policy/guarded-http.ts";
import type { SearchCandidate } from "../../ports/providers.ts";
import type { WebSettings } from "../../settings.ts";
import { createWrapperProvider } from "./builtin-wrapper.ts";
import { createSearxngProvider } from "./searxng.ts";

// 내장 검색 provider 후보(L2.web.spec §3.6.2). 체인 순서는 origin이 정한다: 사용자가 주소를 설정한 SearXNG가 내장 래퍼(builtin)보다 앞이다.
// SearXNG는 `l2.web.search.searxng.url`이 비어 있으면 후보에서 빠진다. 주소를 찾아 나서는 감지는 없다(ADR-0005 개정, 사용자 결정 H1).
// origin 이름 `detected`는 F 계약(`ProviderOrigin`)의 이름을 그대로 쓴 것이다. 여기서는 "사용자가 설정한 내장 provider" 자리를 뜻한다.

export interface BuiltinSearchDeps {
  readonly http: ProviderHttpDeps;
  /** 호출 때마다 읽는 검색 설정. 스레드 범위가 없는 유효값이다 */
  readonly settings: () => WebSettings["search"];
  readonly clock: Clock;
  readonly logger: Logger;
  /** 모델 provider의 hosted 검색 포트. 없으면 래퍼 후보를 만들지 않는다 */
  readonly hosted: HostedSearchPort | undefined;
}

export function createBuiltinSearchCandidates(deps: BuiltinSearchDeps): readonly SearchCandidate[] {
  const candidates: SearchCandidate[] = [
    {
      provider: createSearxngProvider({
        http: deps.http,
        settings: () => deps.settings().searxng,
        logger: deps.logger,
      }),
      origin: "detected",
      cachePolicy: "persist",
      enabled: () => deps.settings().searxng.url !== "",
    },
  ];
  if (deps.hosted !== undefined) {
    candidates.push({
      provider: createWrapperProvider({
        hosted: deps.hosted,
        clock: deps.clock,
        logger: deps.logger,
        settings: () => deps.settings().wrapper,
      }),
      origin: "builtin",
      cachePolicy: "session",
    });
  }
  return candidates;
}
