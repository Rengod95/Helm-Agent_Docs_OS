import type { Clock, Scheduler } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ProducerHandle, SessionService } from "@xeon/contracts/records";
import type { ScopeStack } from "@xeon/contracts/settings";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import type { ToolsDeps, ToolsSession } from "../deps.ts";
import type { CapabilityResolver } from "../entries.ts";
import { createToolRuntime, type ToolRuntime } from "../runtime.ts";
import { configReader } from "../plugin.ts";
import { fakeRedactor } from "./fake-secrets.ts";
import { fakeStore } from "./fake-store.ts";
import { fakeTruncator } from "./fake-truncator.ts";
import { sequentialIds } from "./ids.ts";

// 실제 `ToolService`와 `ApprovalService`(createToolRuntime)를 caller가 준 세션 위에 세운 시험용 조립. 대역 세션(`fakeSession`)과 실제 세션
// (core-persistence의 `createSessionService`)이 모두 맞는다. 다른 패키지의 통합 시험이 승인 프로토콜, 권한 모드, `runUserShell`을
// 대역 구현 없이 확인하는 데 쓴다. 능력 서비스(workspace.shell 등)는 `resolveCapability`로 caller가 준다.
// 태스크 엔진, 잠금 키, 비밀 검사는 붙이지 않는다(해당 기능을 쓰는 호출은 이 조립 밖이다).

export interface RealToolsOptions {
  readonly session: ToolsSession & Pick<SessionService, "producer">;
  readonly clock?: Clock;
  /** 승인 만료 타이머. 생략하면 타이머 없이 시계만 본다 */
  readonly scheduler?: Scheduler;
  readonly ids?: IdFactory;
  /** 파일 범위(managed, user, project, local) 설정 층. 호출마다 읽으므로 시험이 바꿀 수 있다. 세션 범위 층은 session에서 읽는다 */
  readonly layers?: () => ScopeStack;
  /** 도구가 능력 서비스를 찾는 길. 생략하면 어떤 능력도 없다 */
  readonly resolveCapability?: CapabilityResolver;
  /**
   * `core.tools` 생산자 핸들. 세션 서비스 하나에서 생산자는 한 번만 받을 수 있으므로, 같은 세션 위에 서비스를 다시 세워
   * 재시작을 흉내 낼 때 처음 조립이 돌려준 핸들(`RealTools.producer`)을 넘긴다
   */
  readonly producer?: ProducerHandle;
  /** 확장 지점을 쏠 호스트. 생략하면 새로 만든다 */
  readonly host?: TestHost;
}

export interface RealTools extends ToolRuntime {
  readonly host: TestHost;
  readonly ids: IdFactory;
  /** 이 조립이 쓰는 `core.tools` 생산자 핸들 */
  readonly producer: ProducerHandle;
  /** 이 대화에서 확장 지점(ui_prompt_start 등)을 쏠 수 있게 연다 */
  openThread(threadId: ThreadId): Promise<void>;
}

export async function realTools(options: RealToolsOptions): Promise<RealTools> {
  const clock: Clock = options.clock ?? { now: () => 1_767_571_200_000 };
  const ids = options.ids ?? sequentialIds(7000);
  const host = options.host ?? (await createTestHost());
  const layers = options.layers ?? ((): ScopeStack => []);
  const producer = options.producer ?? options.session.producer("core.tools");
  const deps: ToolsDeps = {
    session: options.session,
    producer,
    store: fakeStore(),
    tasks: undefined,
    lockEnv: undefined,
    truncator: fakeTruncator(),
    redactor: fakeRedactor(),
    secrets: undefined,
    ext: host.host,
    resolveCapability: options.resolveCapability ?? (() => undefined),
    config: configReader({ layers }, options.session),
    clock,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ids,
    logger: undefined,
  };
  const runtime = createToolRuntime(deps);
  return {
    ...runtime,
    host,
    ids,
    producer,
    openThread: (threadId) => host.host.openThread(threadId),
  };
}
