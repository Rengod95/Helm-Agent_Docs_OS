import type { Clock, Logger, Scheduler } from "@fresnel/contracts";
import type { AnyCapabilityDef } from "@fresnel/contracts/capabilities";
import type { IdFactory, ThreadId } from "@fresnel/contracts/conversation";
import type { ProducerHandle, SessionService, StoreService } from "@fresnel/contracts/records";
import type { RegistrationId, ToolCallTraceSink } from "@fresnel/contracts/extensions";
import type { DraftMark, Redactor, TieredRule, ToolOutputFiles } from "@fresnel/contracts/services";
import type { ExtHost } from "@fresnel/ext-host";
import type { CapabilityResolver } from "./entries.ts";
import type { InheritPathEnv } from "./inherit-target.ts";
import type { LockEnv, ToolTasks } from "./tasks.ts";
import type { SecretChecker } from "./secret-gate.ts";
import type { ToolsScalarConfig } from "./settings.ts";
import type { OutputTruncator } from "./types.ts";

/** core-tools가 쓰는 fresnel.session의 부분 */
export type ToolsSession = Pick<
  SessionService,
  "commit" | "query" | "readBranch" | "sessionSettings"
>;

/** 한 대화의 현재 설정: 스칼라 값과 티어를 붙인 규칙 */
export interface ToolsConfig extends ToolsScalarConfig {
  readonly rules: readonly TieredRule[];
}

/** 런타임(서비스 조립) 의존. 플러그인이 포트에서 모아 넘기고, 테스트는 대역을 넘긴다 */
/**
 * 한 대화가 보는 도구 이름 규칙(L1.tools.spec §3.3.1). `perThread`로 등록된 항목에만 적용한다.
 * 돌려주는 값이 `null`이면 그 대화에 그 도구는 보이지 않는다(광고에도 호출에도 없다)
 */
export interface ToolExposure {
  nameOf(owner: RegistrationId, requested: string): string | null;
}

export interface ToolsDeps {
  readonly session: ToolsSession;
  /** fresnel.session.producer("core.tools")로 받은 핸들. 플러그인 setup 중 한 번만 받는다 */
  readonly producer: ProducerHandle;
  readonly store: Pick<StoreService, "putBlob" | "readBlob">;
  /** 없으면 tool 범위 노드와 키 큐를 쓰지 않는다 */
  readonly tasks: ToolTasks | undefined;
  /** 잠금 키 산출용. 없으면 키 큐를 쓰지 않는다 */
  readonly lockEnv: LockEnv | undefined;
  /**
   * 승인 상속이 경로를 작업 폴더 기준 실제 경로로 풀 때 쓰는 env를 대화마다 준다(U-11). 없거나 undefined를 돌려주면 상속하지 않는다
   * (해석 수단이 없으면 카드를 건너뛰지 못하게 닫는다)
   */
  readonly pathEnvOf?: (threadId: ThreadId) => InheritPathEnv | undefined;
  /**
   * 등록 id(스코프)가 검토되지 않은 플러그인 초안이면 그 표지를 돌려준다. 없거나 undefined면 검토된 것이다(L1.tools.spec §4.6.1).
   * 플러그인 기능 호출은 호출한 플러그인의 `plugin.scopeId`를, 모델 도구 호출과 플러그인이 부른 도구는 도구 항목의 `owner`를 넘긴다.
   * 조립 루트가 초안 목록(덧씌우기와 시험 실행)에서 만든다. 넘기지 않으면 초안 호출이 없다
   */
  readonly draftOf?: (scopeId: RegistrationId) => DraftMark | undefined;
  /**
   * 호출한 대화가 드래프트 승인 `auto`인 테스트 실행이면 참이다(L1.tools.spec §4.6.1 [결정: 2026-11-18 사용자, AGE-56]). 판정은 등록 범위가 아니라
   * 호출한 대화로 한다. 자식 대화의 답은 조립 루트가 부모를 따라 정한다. 생략하면 모든 대화가 `ask`다
   */
  readonly draftAutoApproved?: (threadId: ThreadId) => boolean;
  /**
   * 대화가 보는 도구 이름 규칙. 조립 루트가 대화의 플러그인 집합(E(T))과 이름 정책으로 만든다. 없거나 undefined를 돌려주면(또는 대화가 없으면)
   * `perThread` 항목이 모두 요청한 이름 그대로 보인다
   */
  readonly exposureOf?: (threadId: ThreadId | null) => ToolExposure | undefined;
  readonly truncator: OutputTruncator;
  /** 잘린 출력의 파일 사본. 없으면 안내 문장에 경로가 없다 */
  readonly outputFiles?: ToolOutputFiles;
  readonly redactor: Redactor;
  /** 시크릿 사용 정책 판정(`check`). 없으면 `secretEnv`를 쓰는 호출은 거부한다 */
  readonly secrets: SecretChecker | undefined;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly resolveCapability: CapabilityResolver;
  /**
   * 플러그인 기능 호출이 찾을 기능 정의. 도구 매핑이 없는 메서드의 합성 항목(`cap:<기능>.<메서드>`)을 정의에서 만든다(U-1 (다)).
   * 모델 도구 광고에는 쓰지 않는다
   */
  readonly capabilityDefs?: readonly AnyCapabilityDef[];
  /** 대화의 현재 설정을 읽는다. threadId가 null이면 세션 범위 층 없이 읽는다 */
  readonly config: (threadId: ThreadId | null) => ToolsConfig;
  readonly clock: Clock;
  /** 승인 만료 타이머(M3-REQ-72). 없으면 타이머 없이 `restore`·`respond`·`open`이 시계를 보고 만료를 해결한다 */
  readonly scheduler?: Scheduler;
  readonly ids: IdFactory;
  readonly logger: Logger | undefined;
  /**
   * 도구 호출 추적 싱크(읽기 전용). 호출이 닫힐 때 한 줄씩 받는다. 없으면 기록 값을 만들지 않는다.
   * 싱크의 실패는 호출 결과를 바꾸지 않는다(정본 turn-record-metrics.md §4.1 규칙 2·7)
   */
  readonly callTrace?: ToolCallTraceSink;
}
