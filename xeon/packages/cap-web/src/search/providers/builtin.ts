import type { Clock, Logger } from "@fresnel/contracts";
import type { HostedSearchPort } from "@fresnel/contracts/services";
import type { SearchCandidate } from "../../ports/providers.ts";
import type { WebSettings } from "../../settings.ts";
import { createWrapperProvider } from "./builtin-wrapper.ts";

// 내장 검색 provider 후보(L2.web.spec §3.6.2). 내장 후보는 검색 래퍼 하나다. 다른 검색 도구는 키나 주소를 정해 플러그인으로 등록한다.
// 래퍼는 모델 provider의 hosted 검색 포트가 있을 때만 후보에 든다.

export interface BuiltinSearchDeps {
  /** 호출 때마다 읽는 검색 설정. 스레드 범위가 없는 유효값이다 */
  readonly settings: () => WebSettings["search"];
  readonly clock: Clock;
  readonly logger: Logger;
  /** 모델 provider의 hosted 검색 포트. 없으면 래퍼 후보를 만들지 않는다 */
  readonly hosted: HostedSearchPort | undefined;
}

export function createBuiltinSearchCandidates(deps: BuiltinSearchDeps): readonly SearchCandidate[] {
  if (deps.hosted === undefined) return [];
  return [
    {
      provider: createWrapperProvider({
        hosted: deps.hosted,
        clock: deps.clock,
        logger: deps.logger,
        settings: () => deps.settings().wrapper,
      }),
      origin: "builtin",
      cachePolicy: "session",
    },
  ];
}
