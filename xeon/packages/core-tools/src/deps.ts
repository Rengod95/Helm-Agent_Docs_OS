import type { Clock, Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ProducerHandle, SessionService, StoreService } from "@xeon/contracts/records";
import type { Redactor, TieredRule } from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import type { CapabilityResolver } from "./entries.ts";
import type { LockEnv, ToolTasks } from "./tasks.ts";
import type { ToolsScalarConfig } from "./settings.ts";
import type { OutputTruncator } from "./types.ts";

/** core-tools가 쓰는 xeon.session의 부분 */
export type ToolsSession = Pick<
  SessionService,
  "commit" | "query" | "readBranch" | "sessionSettings"
>;

/** 한 대화의 현재 설정: 스칼라 값과 티어를 붙인 규칙 */
export interface ToolsConfig extends ToolsScalarConfig {
  readonly rules: readonly TieredRule[];
}

/** 런타임(서비스 조립) 의존. 플러그인이 포트에서 모아 넘기고, 테스트는 대역을 넘긴다 */
export interface ToolsDeps {
  readonly session: ToolsSession;
  /** xeon.session.producer("core.tools")로 받은 핸들. 플러그인 setup 중 한 번만 받는다 */
  readonly producer: ProducerHandle;
  readonly store: Pick<StoreService, "putBlob" | "readBlob">;
  /** 없으면 tool 범위 노드와 키 큐를 쓰지 않는다 */
  readonly tasks: ToolTasks | undefined;
  /** 잠금 키 산출용. 없으면 키 큐를 쓰지 않는다 */
  readonly lockEnv: LockEnv | undefined;
  readonly truncator: OutputTruncator;
  readonly redactor: Redactor;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly resolveCapability: CapabilityResolver;
  /** 대화의 현재 설정을 읽는다. threadId가 null이면 세션 범위 층 없이 읽는다 */
  readonly config: (threadId: ThreadId | null) => ToolsConfig;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger | undefined;
}
