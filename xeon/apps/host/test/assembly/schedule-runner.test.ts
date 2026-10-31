import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunRecord, ScheduleService, ScheduleState } from "@xeon/cap-schedule";
import { err, ok, repeatAsync, type Logger } from "@xeon/contracts";
import type { StoreId } from "@xeon/contracts/wire";
import type { ThreadId, TurnCompletedPayload } from "@xeon/contracts/conversation";
import type {
  CommitBatch,
  DurableEventEnvelope,
  EventKind,
  LeaseToken,
} from "@xeon/contracts/records";
import type { EnqueueReceipt, LoopService, OsService, TaskService } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createFileScheduleStore } from "../../src/assembly/schedule-store.ts";
import { createHostSchedule } from "../../src/assembly/schedule.ts";
import type { EventFeedPort, SessionLockPort, ThreadPort } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// 예약 실행 기록(L4.host-service.spec §4.17, HS-107). 재시작 뒤 `claimed` 실행이 같은 요청으로 다시 시작해도 thread는 하나다.
// 재시작 뒤에는 thread의 저장된 `turn.completed`로 정착한다. 세션은 creationKey로 멱등인 가짜이고, 내구 기록(이벤트 목록)과
// 구독자를 가진다. 상태 파일은 실제 파일 저장소다.

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

/**
 * 프로세스 사이에 남는 공유 상태: 세션(thread 목록, creationKey 표), 입력 요청 키 표, 내구 기록과 그 구독자.
 * 구독자는 프로세스가 건 것이라 프로세스가 죽으면 `dropSubscribers`로 사라진다.
 */
interface SharedSession {
  /** 새로 만든 thread만 쌓는다. creationKey로 돌려준 thread는 여기 다시 들어가지 않는다 */
  readonly created: ThreadId[];
  readonly threads: ThreadPort;
  readonly feed: EventFeedPort;
  readonly locks: SessionLockPort;
  readonly inputs: TaskService["inputs"];
  readonly loop: Pick<LoopService, "whenIdle">;
  /** 내구 기록에 이벤트를 쓰고 살아 있는 구독자에게 알린다 */
  record(threadId: ThreadId, kind: EventKind, payload: unknown): void;
  /** 프로세스가 죽었다: 그 프로세스가 건 구독이 모두 사라진다 */
  dropSubscribers(): void;
  /** 피드 읽기가 실패하는 상황을 흉내 낸다 */
  readonly failing: { head: boolean; read: boolean };
}

function sharedSession(): SharedSession {
  const ids = fixedIdFactory(700);
  const created: ThreadId[] = [];
  const firstByKey = new Map<string, ThreadId>();
  const requests = new Set<string>();
  const log: DurableEventEnvelope[] = [];
  const subscribers = new Set<(batch: CommitBatch) => void>();
  const failing = { head: false, read: false };
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
    feed: partial<EventFeedPort>({
      headSeq: () => (failing.head ? err({ kind: "busy" }) : ok(log.length)),
      read: (after, upto, filter, limit) => {
        if (failing.read) return err({ kind: "busy" });
        const events: DurableEventEnvelope[] = [];
        for (const event of log) {
          if (event.seq <= after || event.seq > upto) continue;
          if (filter?.threadIds !== undefined && !filter.threadIds.includes(event.threadId))
            continue;
          if (
            filter?.kindPrefixes !== undefined &&
            !filter.kindPrefixes.some((prefix) => event.kind.startsWith(prefix))
          ) {
            continue;
          }
          events.push(event);
          if (events.length >= limit) return ok({ events, scannedTo: event.seq });
        }
        return ok({ events, scannedTo: upto });
      },
      onCommit: (listener) => {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    }),
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
    record(threadId, kind, payload) {
      const event = partial<DurableEventEnvelope>({ seq: log.length + 1, threadId, kind, payload });
      log.push(event);
      for (const listener of subscribers) listener(partial<CommitBatch>({ events: [event] }));
    },
    dropSubscribers() {
      subscribers.clear();
    },
    failing,
  };
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

/** 경고 이름을 모아 두는 로거. 저장된 결과를 못 읽은 경로를 시험이 확인하게 한다 */
function recordingLogger(warnings: string[]): Logger {
  const self: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      warnings.push(event);
    },
    error: () => undefined,
    child: () => self,
  };
  return self;
}

/** 예약 서비스 하나. 틱은 돌리지 않고 시험이 `start`로 상태를 복구하게 한다. 프로세스가 바뀌면 새로 만든다 */
function serviceOver(
  session: SharedSession,
  stateDir: string,
  log: Logger = logger,
): ScheduleService {
  return createHostSchedule({
    os: partial<OsService>({}),
    clock: { now: () => NOW },
    ids: fixedIdFactory(100),
    tasks: partial<TaskService>({ inputs: session.inputs }),
    loop: session.loop,
    ownerKind: "service",
    runnerPorts: () => ({ threads: session.threads, locks: session.locks, feed: session.feed }),
    logger: log,
    overrides: {
      ticker: { every: () => () => undefined },
      store: createFileScheduleStore(stateDir),
    },
  });
}

/** `turn.completed`의 payload. TurnCompletedPayloadSchema의 모양을 지킨다 */
function turnCompleted(status: TurnCompletedPayload["status"]): TurnCompletedPayload {
  return { status, stepCount: 1, usage: null, error: status === "failed" ? "model error" : null };
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 실행이 `status`에 이를 때까지 기다린다. 정착 뒤의 기록은 비동기라 상태가 바뀔 때까지 본다. 끝내 안 바뀌면 마지막 상태를 낸다 */
async function untilRun(
  service: ScheduleService,
  status: RunRecord["status"],
): Promise<RunRecord | undefined> {
  const state = { attempts: 0 };
  return await repeatAsync<RunRecord | undefined>(async () => {
    const run = service.runs(SCHEDULE_ID)[0];
    state.attempts += 1;
    if (run?.status === status || state.attempts >= 200) return { value: run };
    await pause(5);
    return undefined;
  });
}

/**
 * 첫 프로세스: claim된 실행을 시작하고 죽는다. 시작한 실행은 started로 남고, 죽은 프로세스의 구독은 사라진다.
 * 돌려주는 thread는 첫 시작이 만든 것이다.
 */
async function firstProcessStarts(session: SharedSession, stateDir: string): Promise<ThreadId> {
  expect((await createFileScheduleStore(stateDir).save(claimedState())).ok).toBe(true);
  const first = serviceOver(session, stateDir);
  expect((await first.start()).ok).toBe(true);
  expect(first.runs(SCHEDULE_ID)[0]?.status).toBe("started");
  // 켜진 타이머 1개와 시작한 실행 1개
  expect(first.pendingSchedules()).toBe(2);
  await first.close();
  session.dropSubscribers();
  const [threadId] = session.created;
  if (threadId === undefined) throw new Error("the first start made no thread");
  return threadId;
}

/** 재시작: 시작을 기록하기 전에 죽은 것처럼 상태를 claim으로 되돌리고 새 서비스가 다시 시작한다 */
async function restartFromClaim(
  session: SharedSession,
  stateDir: string,
  log: Logger = logger,
): Promise<ScheduleService> {
  expect((await createFileScheduleStore(stateDir).save(claimedState())).ok).toBe(true);
  const second = serviceOver(session, stateDir, log);
  expect((await second.start()).ok).toBe(true);
  return second;
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

  test("a turn.completed recorded while no process listens settles the claimed run after a restart", async () => {
    const stateDir = join(root, "schedule");
    const session = sharedSession();
    const threadId = await firstProcessStarts(session, stateDir);
    // 입력은 놓였고 turn은 끝났다. 그 순간 구독하는 프로세스는 없다
    session.record(threadId, "turn.completed", turnCompleted("completed"));

    const second = await restartFromClaim(session, stateDir);
    const run = await untilRun(second, "finished");
    expect(run?.status).toBe("finished");
    expect(run?.outcome).toBe("completed");
    expect(run?.threadId).toBe(threadId);
    expect(session.created).toHaveLength(1);
    // 끝난 실행은 대기 수에 들지 않는다. 남는 것은 켜진 타이머 하나다
    expect(second.pendingSchedules()).toBe(1);
    await second.close();
  });

  test("a stored interrupted turn settles the run as aborted: the run finishes with outcome aborted", async () => {
    const stateDir = join(root, "schedule");
    const session = sharedSession();
    const threadId = await firstProcessStarts(session, stateDir);
    session.record(threadId, "turn.completed", turnCompleted("interrupted"));

    const second = await restartFromClaim(session, stateDir);
    const run = await untilRun(second, "finished");
    expect(run?.status).toBe("finished");
    expect(run?.outcome).toBe("aborted");
    expect(run?.reason).toBeNull();
    await second.close();
  });

  test("a stored failed turn settles the run as failed: status failed with reason run_failed", async () => {
    const stateDir = join(root, "schedule");
    const session = sharedSession();
    const threadId = await firstProcessStarts(session, stateDir);
    session.record(threadId, "turn.completed", turnCompleted("failed"));

    const second = await restartFromClaim(session, stateDir);
    const run = await untilRun(second, "failed");
    expect(run?.status).toBe("failed");
    expect(run?.outcome).toBe("failed");
    expect(run?.reason).toBe("run_failed");
    await second.close();
  });

  test("without a stored turn.completed the run stays started until a live turn.completed arrives", async () => {
    const stateDir = join(root, "schedule");
    const session = sharedSession();
    const threadId = await firstProcessStarts(session, stateDir);
    // 입력은 놓였지만 turn이 아직 끝나지 않았다. 기록에는 turn.completed가 없다
    session.record(threadId, "item.recorded", {});

    const second = await restartFromClaim(session, stateDir);
    await pause(20);
    expect(second.runs(SCHEDULE_ID)[0]?.status).toBe("started");
    expect(second.pendingSchedules()).toBe(2);

    // 살아 있는 구독이 다음 turn.completed를 받아 정착시킨다
    session.record(threadId, "turn.completed", turnCompleted("completed"));
    const run = await untilRun(second, "finished");
    expect(run?.status).toBe("finished");
    expect(run?.outcome).toBe("completed");
    expect(session.created).toHaveLength(1);
    await second.close();
  });

  test.each(["head", "read"] as const)(
    "an unreadable feed (%s) does not throw: the run stays started, then a live turn.completed settles it",
    async (failure) => {
      const stateDir = join(root, "schedule");
      const session = sharedSession();
      const threadId = await firstProcessStarts(session, stateDir);
      // turn.completed는 기록돼 있지만 읽지 못하므로 저장된 결과로는 정착하지 못한다
      session.record(threadId, "turn.completed", turnCompleted("completed"));
      session.failing[failure] = true;
      const warnings: string[] = [];

      const second = await restartFromClaim(session, stateDir, recordingLogger(warnings));
      await pause(20);
      expect(warnings).toContain("schedule.stored_outcome_unreadable");
      expect(second.runs(SCHEDULE_ID)[0]?.status).toBe("started");

      // 구독 경로는 읽기와 무관하게 남아 있다
      session.record(threadId, "turn.completed", turnCompleted("completed"));
      const run = await untilRun(second, "finished");
      expect(run?.outcome).toBe("completed");
      await second.close();
    },
  );
});
