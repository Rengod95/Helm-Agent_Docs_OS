import { Bug, ok, type Logger, type LogFields } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { InputQueuePortKey, LoopPortKey, RecordCommitPortKey } from "@xeon/contracts/extensions";
import { EVENT_CATALOG, type CatalogEntry } from "@xeon/contracts/records";
import {
  createTestHost,
  fixedIdFactory,
  flushMicrotasks,
  type TestHost,
} from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { createLoopService, type LoopServiceHandle } from "../../src/index.ts";
import { createFakeContext, type FakeContext } from "./fake-context.ts";
import { createFakeModels, type FakeModels, type ScriptedResponse } from "./fake-models.ts";
import { createFakeSession, type FakeSession } from "./fake-session.ts";
import { createFakeTasks, type FakeTasks } from "./fake-tasks.ts";
import { createFakeTools, type FakeToolDef, type FakeTools } from "./fake-tools.ts";
import { manualClock, type ManualClock } from "./clock.ts";

interface LogRecord {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields;
}

export interface CapturedLogger {
  readonly logger: Logger;
  readonly records: readonly LogRecord[];
}

export function capturedLogger(): CapturedLogger {
  const records: LogRecord[] = [];
  const make = (base: LogFields): Logger => {
    const write = (level: LogRecord["level"]) => (event: string, fields?: LogFields) => {
      records.push({ level, event, fields: { ...base, ...fields } });
    };
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return { logger: make({}), records };
}

export interface HarnessOptions {
  readonly script?: readonly ScriptedResponse[];
  readonly tools?: readonly FakeToolDef[];
  readonly maxSteps?: number;
  /** l1.loop.gate.maxContinues. 생략하면 기본 8 */
  readonly gateMaxContinues?: number;
  readonly kindLookup?: (kind: string) => CatalogEntry | undefined;
  readonly modelCallsCapacity?: number;
  readonly maxResumeAttempts?: number;
  readonly cancelledByOwner?: () => boolean;
  /** 승인 서비스 대역(`restore`만)을 루프에 건다. 재개 때 `await_input`이면 restore를 부르는지 본다 */
  readonly withApprovals?: boolean;
  /** 루프 서비스를 만들지 않는다. 단계 함수를 직접 부르는 시험(loop-rig)이 `core.loop` 생산자를 쓰려고 한다 */
  readonly withoutLoop?: boolean;
}

export interface Harness {
  readonly clock: ManualClock;
  readonly fake: FakeSession;
  readonly tasks: FakeTasks;
  readonly tools: FakeTools;
  /** `restore`가 불린 thread. withApprovals가 아니면 비어 있다 */
  readonly restored: readonly ThreadId[];
  /** `cancel`로 닫은 승인 id */
  readonly cancelledApprovals: readonly string[];
  readonly models: FakeModels;
  readonly context: FakeContext;
  readonly host: TestHost;
  readonly loop: LoopServiceHandle;
  readonly logs: CapturedLogger;
  readonly threadId: ThreadId;
  /** 실행 중인 turn과 이어지는 followUp turn이 모두 끝나기를 기다린다 */
  settle(): Promise<void>;
  /** 마이크로태스크를 비운다. 진행 중인 turn을 끝까지 기다리지 않고 한 박자만 흘린다 */
  tick(): Promise<void>;
  /** 프로세스 재시작을 흉내 낸다: 기록은 그대로 두고 루프·도구·모델 대역을 새로 만든다 */
  restart(options?: HarnessOptions): Promise<Harness>;
}

const ANY_PAYLOAD = Type.Unknown();

/** 코어 카탈로그와 확장 레코드 kind(스모크 그룹이 쓰는 것)를 아는 조회 */
function testKindLookup(kind: string): CatalogEntry | undefined {
  const core = EVENT_CATALOG.find((entry) => entry.kind === kind);
  if (core !== undefined) return core;
  if (kind.startsWith("grp.") || kind.startsWith("x.")) {
    return { kind: "thread.updated", version: 1, durable: true, payload: ANY_PAYLOAD };
  }
  return undefined;
}

function resolved(): Promise<void> {
  return Promise.resolve();
}

function unavailable(name: string): never {
  throw new Bug(`harness: the loop service is disabled (withoutLoop): ${name}`);
}

function disabledLoop(): LoopServiceHandle {
  return {
    status: () => unavailable("status"),
    runTurn: () => unavailable("runTurn"),
    spawn: () => unavailable("spawn"),
    whenIdle: (_threadId, fn) => fn(),
    admit: () => unavailable("admit"),
    runUserBash: () => unavailable("runUserBash"),
    runChildTurn: () => unavailable("runChildTurn"),
    interrupt: () => unavailable("interrupt"),
    resume: () => unavailable("resume"),
    stopAtSafeBoundary: () => unavailable("stopAtSafeBoundary"),
    threadStatus: () => unavailable("threadStatus"),
    dispose: () => {},
  };
}

async function build(
  fake: FakeSession,
  clock: ManualClock,
  options: HarnessOptions,
  threadId: ThreadId,
  seed: number,
): Promise<Harness> {
  const ids = fixedIdFactory(seed);
  const host = await createTestHost({ without: ["loop", "queue", "records"] });
  const tasks = createFakeTasks({
    session: fake.session,
    ids,
    history: fake.events(),
    ...(options.modelCallsCapacity === undefined
      ? {}
      : { modelCallsCapacity: options.modelCallsCapacity }),
  });
  const tools = createFakeTools({
    session: fake.session,
    ids,
    clock,
    tools: options.tools ?? [],
  });
  const models = createFakeModels({ clock, script: options.script ?? [] });
  const context = createFakeContext({ session: fake.session, clock });
  const logs = capturedLogger();
  const restored: ThreadId[] = [];
  const cancelledApprovals: string[] = [];
  const loop =
    options.withoutLoop === true
      ? disabledLoop()
      : createLoopService({
          clock,
          scheduler: clock,
          ids,
          logger: logs.logger,
          session: fake.session,
          tasks: tasks.service,
          tools: tools.service,
          context: context.service,
          models: models.service,
          ext: host.host,
          ...(options.withApprovals === true
            ? {
                approvals: {
                  restore: async (restoring: ThreadId) => {
                    restored.push(restoring);
                    return ok(await tools.pendingApprovals(restoring));
                  },
                  cancel: (approvalId: string) => {
                    cancelledApprovals.push(approvalId);
                    return Promise.resolve({ applied: true });
                  },
                },
              }
            : {}),
          settings: {
            maxSteps: () => options.maxSteps ?? 0,
            gateMaxContinues: () => options.gateMaxContinues ?? 8,
          },
          basePrompt: "You are a test assistant.",
          hostMode: "in-process",
          kindLookup: options.kindLookup ?? testKindLookup,
          cancelledByOwner: options.cancelledByOwner ?? (() => false),
        });
  await host.host.registerPlatform({
    name: "loop-test-ports",
    setup(ctx) {
      ctx.providePort(LoopPortKey, loop);
      ctx.providePort(InputQueuePortKey, tasks.service);
      ctx.providePort(RecordCommitPortKey, fake.session.ext);
    },
  });
  await host.host.openThread(threadId);

  const harness: Harness = {
    clock,
    fake,
    tasks,
    tools,
    restored,
    cancelledApprovals,
    models,
    context,
    host,
    loop,
    logs,
    threadId,
    async settle() {
      const round = async (left: number): Promise<void> => {
        if (left === 0) return;
        await flushMicrotasks();
        await loop.whenIdle(threadId, resolved);
        await round(left - 1);
      };
      await round(4);
      await host.settled();
    },
    tick: () => flushMicrotasks(),
    async restart(restartOptions = {}) {
      loop.dispose();
      fake.restartProcess();
      return build(fake, clock, restartOptions, threadId, seed + 500_000);
    },
  };
  return harness;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const clock = manualClock();
  const seedIds = fixedIdFactory(2_000_000);
  const fake = createFakeSession({
    clock,
    ids: seedIds,
    ...(options.maxResumeAttempts === undefined
      ? {}
      : { maxResumeAttempts: options.maxResumeAttempts }),
  });
  const threadId = fake.startThread();
  return build(fake, clock, options, threadId, 1_000_000);
}
