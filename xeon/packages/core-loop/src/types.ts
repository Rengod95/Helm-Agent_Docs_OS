import type { Clock, Logger } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { CatalogEntry, SessionService } from "@xeon/contracts/records";
import type {
  ApprovalService,
  ContextService,
  ModelService,
  TaskScope,
  TaskService,
  ThreadLoopStatus,
  ToolService,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import type { CommitFailure } from "./commit.ts";
import type { Drafter } from "./drafts.ts";
import type { TurnStartPlanned } from "./turn-start.ts";
import type { LoopSettingsSource } from "./settings.ts";
import type { ThreadGate } from "./thread-gate.ts";

/** 루프가 `xeon.ext`에서 쓰는 부분: 지점 발화와 단계 경계 훅 */
export type LoopExtHost = Pick<ExtHost, "dispatch" | "boundary">;

/** `RecoverDeps.hostMode`와 같은 값 */
export type HostMode = "in-process" | "stdio" | "service";

/** 서비스 주입과 설정. 조립은 plugin.ts(운영) 또는 테스트가 한다 */
export interface LoopDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly session: SessionService;
  readonly tasks: TaskService;
  readonly tools: ToolService;
  readonly context: ContextService;
  readonly models: ModelService;
  readonly ext: LoopExtHost;
  readonly settings: LoopSettingsSource;
  /** 기본 시스템 프롬프트. `before_agent_start`가 바꿀 수 있다 */
  readonly basePrompt: string;
  readonly hostMode: HostMode;
  /** boundary 엔트리 kind의 payload 스키마 조회(`finalizeBoundary` 규칙 1). 운영은 X의 kind 등록을 넘긴다 */
  readonly kindLookup: (kind: string) => CatalogEntry | undefined;
  /** 소유 사슬 취소 판정(`RecoverDeps.cancelledByOwner`, L1.tasks.spec §4.8 3번) */
  readonly cancelledByOwner: (threadId: ThreadId, turnId: TurnId) => boolean;
  /** `user_bash` 지점 페이로드의 `cwd`. 조립 루트가 프로젝트 작업 디렉터리를 넘긴다. 생략하면 빈 문자열이다 */
  readonly workingDirectory?: string;
  /** 있으면 `await_input` 재진입 전에 미해결 승인 요청을 메모리 대기로 되살린다 */
  readonly approvals?: Pick<ApprovalService, "restore" | "cancel">;
}

/** turn 시작(T1) 결과. 큐 입력 시작과 drive 시작이 함께 쓴다 */
export type StartOutcome =
  | {
      readonly status: "started";
      readonly turnId: TurnId;
      readonly planned: TurnStartPlanned;
    }
  | { readonly status: "rejected"; readonly failure: CommitFailure }
  | { readonly status: "failed"; readonly reason: string };

/** 열린 turn 하나의 실행 중 상태 */
export interface RunningTurn {
  readonly turnId: TurnId;
  readonly scope: TaskScope;
  stepIndex: number | null;
  phase: ThreadLoopStatus["phase"];
}

/** thread 하나의 구동 상태 */
export interface ThreadRuntime {
  readonly threadId: ThreadId;
  readonly gate: ThreadGate;
  /** thread 범위 노드. 엔진이 살아 있는 동안 유지한다 */
  readonly scope: TaskScope;
  running: RunningTurn | null;
  /** 큐 입력으로 turn을 여는 중인 작업. 같은 thread의 중복 시작을 하나로 합친다 */
  starting: Promise<StartOutcome | undefined> | null;
  /** 피드가 알려 준 활성 가지의 마지막 이벤트. 커밋한 쪽과 무관하게 최신이다 */
  leaf: EventId | null;
  /** `stopAtSafeBoundary`가 진행 중이다 */
  stopRequested: boolean;
  /** 이 프로세스가 T1에서 배치한 큐 입력 → turn. `admit`이 자기 입력이 시작됐는지 알아볼 때 쓴다 */
  readonly placed: Map<EventId, TurnId>;
}

/** 모듈 안에서 함께 쓰는 의존 묶음 */
export interface LoopContext extends LoopDeps {
  readonly drafter: Drafter;
}
