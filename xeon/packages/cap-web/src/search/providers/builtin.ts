import type { Clock, Logger } from "@xeon/contracts";
import type { HostedSearchPort } from "@xeon/contracts/services";
import type { ProviderHttpDeps } from "../../policy/guarded-http.ts";
import type { SearchCandidate } from "../../ports/providers.ts";
import type { WebSettings } from "../../settings.ts";
import { createWrapperProvider } from "./builtin-wrapper.ts";
import { createSearxngProvider } from "./searxng.ts";

// 내장 검색 provider 후보(L2.web.spec §3.6.2). 체인 순서는 origin이 정한다: 감지된 SearXNG(detected)가 내장 래퍼(builtin)보다 앞이다.

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
