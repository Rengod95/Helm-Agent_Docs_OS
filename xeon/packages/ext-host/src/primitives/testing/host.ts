import type { IdFactory, ThreadId, StepId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import {
  InputQueuePortKey,
  LoopPortKey,
  RecordCommitPortKey,
  type ExtCommitResult,
} from "@xeon/contracts/extensions";
import type { DispatchPolicy } from "../dispatch-types.ts";
import type { ExtDiagnostic } from "../errors.ts";
import { createExtHost, hostInternalsOf, type ExtHost } from "../host.ts";
import type { PrimitivesSettingsSource } from "../core.ts";
import { createStaticPrimitivesSettings, type StaticPrimitivesSettings } from "../settings.ts";
import { fixedIdFactory } from "./ids.ts";
import {
  memoryInputQueue,
  memoryLoopPort,
  memoryRecordStore,
  type MemoryInputQueue,
  type MemoryLoopOptions,
  type MemoryLoopPort,
  type MemoryRecordStore,
} from "./ports.ts";
import { fakeTimers, flushMicrotasks, type FakeTimers } from "./timers.ts";

export interface TestHostOptions {
  /** 같은 가짜 시계를 정책 등 다른 곳과 나눠 쓸 때 넘긴다 */
  readonly timers?: FakeTimers;
  readonly strict?: boolean;
  readonly policy?: DispatchPolicy;
  readonly setupBudgetMs?: number | null;
  /** setup 예산을 호출 때마다 읽는다. 정책(OperationsPolicy.setupBudgetMs)을 그대로 넘길 때 쓴다 */
  readonly setupBudget?: () => number | null;
  readonly settings?: StaticPrimitivesSettings;
  /** thread마다 다른 값을 돌려주는 설정 읽기. 있으면 settings 대신 쓴다(session 범위 값을 시험한다) */
  readonly settingsSource?: PrimitivesSettingsSource;
  readonly loop?: MemoryLoopOptions;
  /** 다른 호스트와 나눠 쓸 대역. 프로세스 재시작을 흉내 낼 때 같은 저장소를 새 호스트에 넘긴다 */
  readonly shared?: {
    readonly loop?: MemoryLoopPort;
    readonly queue?: MemoryInputQueue;
    readonly records?: MemoryRecordStore;
  };
  /** 포트를 등록하지 않을 이름. 포트 부재를 시험한다 */
  readonly without?: readonly ("loop" | "queue" | "records")[];
}

export interface BoundaryStep {
  readonly turnId?: TurnId;
  readonly stepId?: StepId;
  /** 참이면 커밋이 실패한 것으로 settle한다 */
  readonly fail?: boolean;
}

/** L1이 하는 일을 흉내 낸다: prepare → 기여 초안을 따로 커밋 → settle */
export interface TestBoundary {
  stepEnd(step?: BoundaryStep): Promise<readonly DurableEventDraft[]>;
  turnSettled(step?: BoundaryStep): Promise<readonly DurableEventDraft[]>;
  idle(step?: BoundaryStep): Promise<readonly DurableEventDraft[]>;
}

export interface TestHost {
  readonly host: ExtHost;
  readonly timers: FakeTimers;
  readonly ids: IdFactory;
  readonly loop: MemoryLoopPort;
  readonly queue: MemoryInputQueue;
  readonly records: MemoryRecordStore;
  readonly diagnostics: readonly ExtDiagnostic[];
  /** 새 thread id */
  newThread(): ThreadId;
  boundary(threadId: ThreadId): TestBoundary;
  /** 백그라운드 작업(drive 호출, 유휴 적용, 능력 바인딩)이 모두 끝나기를 기다린다 */
  settled(): Promise<void>;
}

/** M0 인메모리 포트로 동작하는 ExtHost와 도우미 묶음(X.primitives.plan P-14) */
export async function createTestHost(options: TestHostOptions = {}): Promise<TestHost> {
  const timers = options.timers ?? fakeTimers();
  const ids = fixedIdFactory();
  const diagnostics: ExtDiagnostic[] = [];
  const loop = options.shared?.loop ?? memoryLoopPort(options.loop);
  const queue = options.shared?.queue ?? memoryInputQueue();
  const records = options.shared?.records ?? memoryRecordStore();
  const host = createExtHost({
    ids,
    now: timers.now,
    setTimer: timers.setTimer,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    setupBudgetMs: options.setupBudget ?? (() => options.setupBudgetMs ?? null),
    settings: options.settingsSource ?? createStaticPrimitivesSettings(options.settings),
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
    strict: options.strict ?? true,
  });
  const without = new Set(options.without ?? []);
  await host.registerPlatform({
    name: "test-ports",
    setup(ctx) {
      if (!without.has("loop")) ctx.providePort(LoopPortKey, loop);
      if (!without.has("queue")) ctx.providePort(InputQueuePortKey, queue);
      if (!without.has("records")) ctx.providePort(RecordCommitPortKey, records);
    },
  });
  let boundaryCounter = 0;

  async function run(
    threadId: ThreadId,
    kind: "step_end" | "turn_settled" | "idle",
    step: BoundaryStep = {},
  ): Promise<readonly DurableEventDraft[]> {
    const signal = {
      threadId,
      kind,
      ...(step.turnId === undefined ? {} : { turnId: step.turnId }),
      ...(step.stepId === undefined ? {} : { stepId: step.stepId }),
    };
    const contribution = await host.boundary.prepare(signal);
    let committed = step.fail !== true;
    if (contribution.drafts.length > 0 && committed) {
      boundaryCounter += 1;
      const result: ExtCommitResult = await records.commit({
        threadId,
        requestId: `test:boundary:${boundaryCounter}`,
        drafts: contribution.drafts,
      });
      committed = result.status !== "rejected";
    }
    await host.boundary.settle(signal, committed ? "committed" : "failed");
    await flushMicrotasks();
    return contribution.drafts;
  }

  return {
    host,
    timers,
    ids,
    loop,
    queue,
    records,
    diagnostics,
    newThread: () => ids.next("thr"),
    boundary: (threadId) => ({
      stepEnd: (step) => run(threadId, "step_end", step),
      turnSettled: (step) => run(threadId, "turn_settled", step),
      idle: (step) => run(threadId, "idle", step),
    }),
    async settled() {
      await flushMicrotasks();
      await hostInternalsOf(host).whenSettled();
      await flushMicrotasks();
    },
  };
}
