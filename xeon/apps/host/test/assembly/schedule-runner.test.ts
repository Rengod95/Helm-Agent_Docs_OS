import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ScheduleService, ScheduleState } from "@xeon/cap-schedule";
import { ok, type Logger } from "@xeon/contracts";
import type { StoreId } from "@xeon/contracts/wire";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LeaseToken } from "@xeon/contracts/records";
import type { EnqueueReceipt, LoopService, OsService, TaskService } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createFileScheduleStore } from "../../src/assembly/schedule-store.ts";
import { createHostSchedule } from "../../src/assembly/schedule.ts";
import type { EventFeedPort, SessionLockPort, ThreadPort } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// 예약 실행 기록(L4.host-service.spec §4.17, HS-107). 재시작 뒤 `claimed` 실행이 같은 요청으로 다시 시작해도 thread는 하나다.
// 세션은 creationKey로 멱등인 가짜다(L1.persistence §4.10.1). 상태 파일은 실제 파일 저장소다.

const STORE_ID: StoreId = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SCHEDULE_ID = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const RUN_ID = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const DUE_AT = 601_000;
const NOW = 1_000;

/** 쓰기 전 `claim`만 남은 상태. 시작을 기록하기 전에 프로세스가 죽은 것과 같다 */
function claimedState(): ScheduleState {
  return {
    version: 1,
    entries: [
      {
        id: SCHEDULE_ID,
        trigger: { kind: "interval", everySeconds: 600 },
        prompt: "요약을 만든다",
        workspace: null,
        title: null,
        sessionKind: "cron",
        enabled: true,
        createdAt: 500,
        nextDueAt: 1_201_000,
        lastStartedAt: null,
        iterations: 0,
        stoppedReason: null,
      },
    ],
    runs: [
      {
        runId: RUN_ID,
        scheduleId: SCHEDULE_ID,
        firedBy: "interval",
        dueAt: DUE_AT,
        claimedAt: DUE_AT,
        missed: false,
        status: "claimed",
        threadId: null,
        startedAt: null,
        endedAt: null,
        outcome: null,
        reason: null,
        skippedCount: 0,
      },
    ],
  };
}

/** 한 프로세스의 생존과 무관한 공유 상태: 세션(thread 목록, creationKey 표), 입력 요청 키 표 */
interface SharedSession {
  /** 새로 만든 thread만 쌓는다. creationKey로 돌려준 thread는 여기 다시 들어가지 않는다 */
  readonly created: ThreadId[];
  readonly threads: ThreadPort;
  readonly feed: EventFeedPort;
  readonly locks: SessionLockPort;
  readonly inputs: TaskService["inputs"];
  readonly loop: Pick<LoopService, "whenIdle">;
}

function sharedSession(): SharedSession {
  const ids = fixedIdFactory(700);
  const created: ThreadId[] = [];
  const firstByKey = new Map<string, ThreadId>();
  const requests = new Set<string>();
  const token: LeaseToken = { resource: "session:thr", holderId: "h", epoch: 1 };
  return {
    created,
    threads: partial<ThreadPort>({
      create: (input) => {
        const key = input.creationKey;
        const known = key === undefined ? undefined : firstByKey.get(key);
        if (known !== undefined) {
          return Promise.resolve({ threadId: known, position: { storeId: STORE_ID, seq: 1 } });
        }
        const threadId = ids.next("thr");
        created.push(threadId);
        if (key !== undefined) firstByKey.set(key, threadId);
        return Promise.resolve({ threadId, position: { storeId: STORE_ID, seq: 1 } });
      },
    }),
    feed: partial<EventFeedPort>({ onCommit: () => () => undefined }),
    locks: partial<SessionLockPort>({
      tryAcquire: () => Promise.resolve({ ok: true, token, release: () => Promise.resolve() }),
      release: () => Promise.resolve(),
    }),
    inputs: partial<TaskService["inputs"]>({
      enqueue: (draft) => {
        // 같은 요청 키의 두 번째 넣기는 기존 입력을 duplicate로 돌려준다(core-tasks input-queue)
        const duplicate = requests.has(draft.requestId);
        requests.add(draft.requestId);
        const receipt: EnqueueReceipt = {
          requestId: draft.requestId,
          duplicate,
          inputId: ids.next("evt"),
          state: "queued",
        };
        return Promise.resolve(ok(receipt));
      },
    }),
    loop: partial<Pick<LoopService, "whenIdle">>({ whenIdle: (_threadId, run) => run() }),
  };
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

/** 예약 서비스 하나. 틱은 돌리지 않고 시험이 `start`로 상태를 복구하게 한다. 프로세스가 바뀌면 새로 만든다 */
function serviceOver(session: SharedSession, stateDir: string): ScheduleService {
  return createHostSchedule({
    os: partial<OsService>({}),
    clock: { now: () => NOW },
    ids: fixedIdFactory(100),
    tasks: partial<TaskService>({ inputs: session.inputs }),
    loop: session.loop,
    ownerKind: "service",
    runnerPorts: () => ({ threads: session.threads, locks: session.locks, feed: session.feed }),
    logger,
    overrides: {
      ticker: { every: () => () => undefined },
      store: createFileScheduleStore(stateDir),
    },
  });
}

describe("the schedule runner after a restart (L2.schedule §4.4.4, L4.host-service HS-107)", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "xh-sch-run-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a claimed run begun again after a restart reuses the thread it made before, so only one thread exists", async () => {
    const stateDir = join(root, "schedule");
    const store = createFileScheduleStore(stateDir);
    expect((await store.save(claimedState())).ok).toBe(true);
    const session = sharedSession();

    // 첫 시작: claim만 된 실행이 thread를 하나 만들고 시작한다
    const first = serviceOver(session, stateDir);
    expect((await first.start()).ok).toBe(true);
    const threadId = first.runs(SCHEDULE_ID)[0]?.threadId;
    expect(threadId).not.toBeNull();
    expect(session.created).toHaveLength(1);
    await first.close();

    // 재시작: 시작을 기록하기 전에 죽은 것처럼 상태를 claim으로 되돌리고 새 서비스가 다시 시작한다
    expect((await store.save(claimedState())).ok).toBe(true);
    const second = serviceOver(session, stateDir);
    expect((await second.start()).ok).toBe(true);
    const again = second.runs(SCHEDULE_ID)[0];
    expect(again?.status).toBe("started");
    expect(again?.threadId).toBe(threadId);
    expect(session.created).toHaveLength(1);
    await second.close();
  });
});
