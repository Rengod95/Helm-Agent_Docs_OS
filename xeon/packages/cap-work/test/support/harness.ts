// 실제 SQLite(platform-store) 위에 core-persistence 세션 서비스를 올리고 cap-work 작업 서비스를 붙이는 시험 조립.
// 저장소를 배열로 흉내 내지 않는다(eng.testing.guide TS-07).
import { Bug, type Logger, type LogFields } from "@xeon/contracts";
import type { CallOptions, CapabilityApi, WorkTasks } from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { SessionService } from "@xeon/contracts/records";
import { createSessionService } from "@xeon/core-persistence";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "@xeon/platform-store/testing";
import { withProjection, type ProjectingSession } from "./projecting-session.ts";
import { createTasksApi } from "../../src/tasks/service.ts";
import { createWorkProjector } from "../../src/projection/projector.ts";
import { DEFAULT_WORK_SETTINGS, type WorkSettings } from "../../src/settings.ts";
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
}

export interface BaseOptions {
  readonly path?: string;
}

export interface HarnessOptions extends BaseOptions {
  readonly settings?: WorkSettings;
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
  const projecting: ProjectingSession = withProjection(created.value, store.root);
  const session = projecting.session;
  const loop = session.producer("core.loop");
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

/** 작업 서비스를 직접 조립한다(플러그인을 거치지 않는다) */
export async function openHarness(options: HarnessOptions = {}): Promise<Harness> {
  const base = await openBase(options);
  const registered = base.session.projectors.register(createWorkProjector());
  if (!registered.ok)
    throw new Bug("harness could not register cap.work", { cause: registered.error });
  const settings = { current: options.settings ?? DEFAULT_WORK_SETTINGS };
  const api = createTasksApi({
    session: base.session,
    reader: base.store.service.scoped("cap.work"),
    producer: base.session.producer("cap.work"),
    ids: base.ids,
    logger: recordingLogger(base.logs),
    settings: () => settings.current,
  });
  return Object.assign(base, {
    api,
    setSettings(next: WorkSettings): void {
      settings.current = next;
    },
  });
}
