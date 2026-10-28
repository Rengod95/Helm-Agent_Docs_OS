import type { Clock, Logger } from "@xeon/contracts";
import type { LocalIdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { FetchCache } from "./cache/fetch-cache.ts";
import type { SourceIdRegistry } from "./contract/source-ids.ts";
import type { SessionLimits } from "./cost/limits.ts";
import type { UsageMeter } from "./cost/meter.ts";
import type { ConvertRunner } from "./fetch/convert-runner.ts";
import type { Access } from "./policy/access.ts";
import type { ContentHttp } from "./policy/content-http.ts";
import type { RobotsChecker } from "./policy/robots.ts";
import type { SeenUrls } from "./policy/seen-urls.ts";
import type { WebProviderCatalog } from "./ports/providers.ts";
import type { ProbeCache } from "./search/probe-cache.ts";
import type { WebSettings } from "./settings.ts";

/** 서비스 조립에 필요한 의존. 조립 루트가 포트에서 모아 넘기고, 시험은 대역을 넘긴다 */
export interface WebDeps {
  readonly clock: Clock;
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  /** UA 문자열 `Xeon/<버전>`. 프로젝트 URL은 정해지지 않았다 [미결] */
  readonly userAgent: string;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: ThreadId | undefined) => WebSettings;
  readonly access: Access;
  readonly content: ContentHttp;
  /** 호스트별 24시간 캐시를 가진 robots.txt 검사기(`createRobotsGate`) */
  readonly robots: RobotsChecker;
  readonly convert: ConvertRunner;
  /** 저장소가 없으면(L0.store 미연결) 디스크 캐시와 rawRef 없이 동작한다 */
  readonly cache: FetchCache | undefined;
  readonly meter: UsageMeter | undefined;
  readonly limits: SessionLimits;
  readonly seen: SeenUrls;
  readonly sourceIds: SourceIdRegistry;
  readonly catalog: WebProviderCatalog;
  readonly probes: ProbeCache;
}
