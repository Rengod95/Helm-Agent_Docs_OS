// 실제 SQLite(platform-store) 위에 core-persistence 세션 서비스를 올리고 cap-work 작업 서비스를 붙이는 시험 조립.
// 저장소를 배열로 흉내 내지 않는다(eng.testing.guide TS-07).
import { Bug, type Logger, type LogFields } from "@xeon/contracts";
import type {
  CallOptions,
  CapabilityApi,
  WorkPlans,
  WorkTasks,
} from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { SessionService } from "@xeon/contracts/records";
import { createSessionService } from "@xeon/core-persistence";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "@xeon/platform-store/testing";
import { withProjection, type ProjectingSession } from "./projecting-session.ts";
import type { WorkPlansDeps } from "../../src/deps.ts";
import { startPlanModeListener, type PlanModeListener } from "../../src/plans/listener.ts";
import { createPlans, type PlansRuntime } from "../../src/plans/service.ts";
import {
  createFakeApprovals,
  createFakeArtifacts,
  createFakePermissionMode,
  createFakeWriter,
  type FakeApprovals,
  type FakeArtifacts,
  type FakePermissionMode,
  type FakeWriter,
} from "../../src/testing/index.ts";
import { createTasksApi } from "../../src/tasks/service.ts";
import { createWorkProjector } from "../../src/projection/projector.ts";
import { DEFAULT_WORK_SETTINGS, type WorkSettings } from "../../src/settings.ts";
import { flushMicrotasks } from "@xeon/ext-host/testing";
import { fixedIdFactory, manualClock, type ManualClock } from "./clock.ts";

interface LogLine {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ level: "debug", event, fields }),
    info: (event, fields) => void lines.push({ level: "info", event, fields }),
    warn: (event, fields) => void lines.push({ level: "warn", event, fields }),
    error: (event, fields) => void lines.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

export interface Base extends AsyncDisposable {
  readonly clock: ManualClock;
  readonly ids: IdFactory;
  readonly store: TestStore;
  readonly session: SessionService;
  /** 투영 테이블을 지우고 이벤트에서 다시 만든다 */
  rebuild(): Promise<void>;
  readonly threadId: ThreadId;
  readonly logs: LogLine[];
  /** L1.tools 대역이 이벤트를 남기는 길(`core.tools` 생산자) */
  readonly writer: FakeWriter;
  /** 쓰기 호출 옵션. requestId를 생략하면 호출마다 새 값을 만든다 */
  opts(requestId?: string, thread?: ThreadId): CallOptions;
  /** 새 스레드를 만들어 쓰기 모드로 연다 */
  newThread(): ThreadId;
  /** 내구 이벤트 수 */
  eventCount(): number;
  /** turn.started와 turn.completed를 커밋 하나로 남긴다(완료된 턴 하나) */
  completeTurn(thread?: ThreadId): void;
  /** cap_work_* 테이블마다 행 내용의 해시 */
  workDigests(): Promise<Readonly<Record<string, string>>>;
}

/** 작업 서비스를 붙인 조립 */
export interface Harness extends Base {
  readonly api: CapabilityApi<typeof WorkTasks>;
  /** 설정을 바꾼다. 호출마다 읽으므로 다음 호출부터 적용된다 */
  setSettings(next: WorkSettings): void;
  readonly plans: CapabilityApi<typeof WorkPlans>;
  readonly runtime: PlansRuntime;
  readonly mode: FakePermissionMode;
  readonly approvals: FakeApprovals;
  /** artifacts: false로 열면 없다 */
  readonly artifacts: FakeArtifacts | undefined;
  readonly listener: PlanModeListener | undefined;
  /** 프로세스 재시작을 흉내 낸다: 같은 저장소와 L1 대역 위에 새 계획 런타임을 만든다(메모리 상태가 없다) */
  restartPlans(overrides?: Partial<WorkPlansDeps>): PlansRuntime;
  /** 마이크로태스크와 구독 처리가 끝나기를 기다린다 */
  settle(): Promise<void>;
}

export interface BaseOptions {
  readonly path?: string;
}

export interface HarnessOptions extends BaseOptions {
  readonly settings?: WorkSettings;
  /** false면 산출물 포트 없이 연다 */
  readonly artifacts?: boolean;
}

/** 저장소와 세션 서비스(투영기 등록부 대역 포함)만. 플러그인 시험이 쓴다 */
export async function openBase(options: BaseOptions = {}): Promise<Base> {
  const clock = manualClock();
  const ids = fixedIdFactory(1);
  const store = await openTestStore({
    clock,
    ids,
    ...(options.path === undefined ? {} : { path: options.path }),
  });
  const logs: LogLine[] = [];
  const created = createSessionService({
    db: store.root,
    leases: store.leases,
    migrations: store.service.migrations,
    readBlob: (ref) => store.service.readBlob(ref),
    putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
    clock,
    ids,
    logger: recordingLogger(logs),
    holder: TEST_HOLDER_A,
  });
  if (!created.ok)
    throw new Bug("harness could not create the session service", { cause: created.error });
  const projecting: ProjectingSession = withProjection(created.value, store.root, ids, () =>
    clock.now(),
  );
  const session = projecting.session;
  const loop = session.producer("core.loop");
  const writer = createFakeWriter({
    session,
    tools: session.producer("core.tools"),
    recordSetting: (threadId, payload) => {
      projecting.recordSetting(threadId, payload);
    },
    ids,
  });
  let counter = 0;
  const newThread = (): ThreadId => {
    const threadId = ids.next("thr");
    const made = session.threads.create({ threadId });
    if (!made.ok) throw new Bug("harness: thread create failed", { cause: made.error });
    const token = store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Bug("harness: lease failed", { cause: token.error });
    const opened = session.openForWrite(threadId, token.value);
    if (!opened.ok) throw new Bug("harness: open failed", { cause: opened.error });
    return threadId;
  };
  const threadId = newThread();
  return {
    clock,
    ids,
    store,
    session,
    rebuild: () => projecting.rebuild(),
    threadId,
    logs,
    writer,
    opts(requestId, thread = threadId) {
      counter += 1;
      return {
        requestId: requestId ?? `req-${counter}`,
        context: { threadId: thread, caller: { kind: "model", agent: "main" } },
      };
    },
    newThread,
    eventCount() {
      const rows = store.root.read((tx) => tx.get("SELECT count(*) AS n FROM events"));
      if (!rows.ok || rows.value === undefined) throw new Bug("harness: event count failed");
      return Number(rows.value["n"]);
    },
    completeTurn(thread = threadId) {
      const turnId = ids.next("trn");
      const scope = { turnId, stepId: null };
      const draft = (kind: "turn.started" | "turn.completed", payload: unknown) =>
        loop.draft({
          id: ids.next("evt"),
          kind,
          threadId: thread,
          turnId: scope.turnId,
          stepId: scope.stepId,
          causationId: null,
          correlationId: turnId,
          payload,
        });
      counter += 1;
      const result = session.commit({
        threadId: thread,
        requestId: `turn:${turnId}`,
        fingerprintSource: { turnId },
        build: () => ({
          kind: "append",
          drafts: [
            draft("turn.started", { inputItemIds: [], requestId: null, scopeId: null }),
            draft("turn.completed", {
              status: "completed",
              stepCount: 0,
              usage: null,
              error: null,
            }),
          ],
          checkpoint: null,
        }),
      });
      if (!result.ok || result.value.status !== "committed") {
        throw new Bug("harness: turn commit failed", { cause: result });
      }
    },
    async workDigests() {
      const all = await store.rowDigests();
      return Object.fromEntries(
        Object.entries(all).filter(([name]) => name.startsWith("cap_work_")),
      );
    },
    async [Symbol.asyncDispose]() {
      await store[Symbol.asyncDispose]();
    },
  };
}

/** 작업·계획 서비스를 직접 조립한다(플러그인을 거치지 않는다) */
export async function openHarness(options: HarnessOptions = {}): Promise<Harness> {
  const base = await openBase(options);
  const registered = base.session.projectors.register(createWorkProjector());
  if (!registered.ok)
    throw new Bug("harness could not register cap.work", { cause: registered.error });
  const settings = { current: options.settings ?? DEFAULT_WORK_SETTINGS };
  const logger = recordingLogger(base.logs);
  const mode = createFakePermissionMode({ writer: base.writer });
  const approvals = createFakeApprovals({
    writer: base.writer,
    ids: base.ids,
    now: () => base.clock.now(),
  });
  approvals.onPlanMode = (threadId, next) => {
    mode.set(threadId, next);
  };
  const artifacts = options.artifacts === false ? undefined : createFakeArtifacts();
  const deps: WorkPlansDeps = {
    session: base.session,
    reader: base.store.service.scoped("cap.work"),
    producer: base.session.producer("cap.work"),
    ids: base.ids,
    logger,
    settings: () => settings.current,
    mode,
    approvals: approvals.factory,
    artifacts,
  };
  const api = createTasksApi(deps);
  const runtime = createPlans(deps);
  const listener = startPlanModeListener(base.session, runtime, logger);
  const settle = async (): Promise<void> => {
    await flushMicrotasks();
    await listener?.settled();
    await flushMicrotasks();
  };
  return Object.assign(base, {
    api,
    plans: runtime.api,
    runtime,
    mode,
    approvals,
    artifacts,
    listener,
    setSettings(next: WorkSettings): void {
      settings.current = next;
    },
    restartPlans: (overrides = {}) => createPlans({ ...deps, ...overrides }),
    settle,
  });
}
