import { join } from "node:path";
import {
  assertNever,
  attemptAsync,
  detach,
  err,
  ok,
  parse,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import {
  TurnCompletedPayloadSchema,
  type IdFactory,
  type ThreadId,
} from "@xeon/contracts/conversation";
import type { Unsubscribe } from "@xeon/contracts/extensions";
import type {
  InputDraft,
  LoopService,
  OsService,
  TaskService,
  WatchHandle,
} from "@xeon/contracts/services";
import {
  createScheduleService,
  type RunOutcome,
  type RunRequest,
  type RunnerFailure,
  type ScheduleIds,
  type ScheduleRunner,
  type ScheduleService,
  type ScheduleTicker,
  type ScheduleWatcher,
  type StartedRun,
} from "@xeon/cap-schedule";
import type {
  EventFeedPort,
  OwnerKind,
  ScheduleOverrides,
  SessionLockPort,
  ThreadPort,
} from "../types.ts";
import { messageOf } from "../util.ts";
import { toLogFields } from "./ports.ts";
import { createFileScheduleStore } from "./schedule-store.ts";

// L2.schedule.spec §4.4.9, L4.host-service.spec §4.17. 예약 상태 기계(`@xeon/cap-schedule`)에 호스트의 포트를 잇는다.
// 실행은 새 thread를 만들고 그 thread에 무인 입력을 넣는다. 그 입력은 `schedule` 출처의 followUp이라 turn의 `interactive`가 거짓이다.

/** 상태 디렉터리 아래 예약 폴더 이름 */
const SCHEDULE_DIR_NAME = "schedule";
/** 자동 제목에 쓰는 프롬프트 글자 수 */
const TITLE_CHARS = 40;
/** `evt_` 접두의 길이. 예약 ID는 주입된 IdFactory의 ULID 본문을 빌린다 */
const EVENT_PREFIX_LENGTH = "evt_".length;

/**
 * 실행이 쓰는 엔진 포트. 예약 서비스는 엔진 포트보다 먼저 만들어지므로(포트가 예약 서비스를 담는다) 조립 루트가
 * `createEnginePorts` 뒤에 이 자리를 채운다. 실행은 서비스가 시작한 뒤에만 일어난다.
 */
export interface ScheduleRunnerPorts {
  readonly threads: ThreadPort;
  readonly locks: SessionLockPort;
  readonly feed: EventFeedPort;
}

export interface HostScheduleDeps {
  readonly os: Pick<OsService, "dirs" | "time" | "watch">;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly tasks: Pick<TaskService, "inputs">;
  readonly loop: Pick<LoopService, "whenIdle">;
  /** 세션 쓰기 소유를 얻을 때 쓰는 소유 종류(HostMode에서 정한다) */
  readonly ownerKind: OwnerKind;
  readonly runnerPorts: () => ScheduleRunnerPorts;
  readonly logger: Logger;
  /** 시험 주입(시계, 틱, 저장소, 정책). 운영은 생략한다 */
  readonly overrides?: ScheduleOverrides;
}

/** 예약 서비스를 조립한다. 틱과 감시는 `start()`가 시작하므로 호출만으로는 아무것도 돌지 않는다 */
export function createHostSchedule(deps: HostScheduleDeps): ScheduleService {
  const overrides = deps.overrides;
  return createScheduleService({
    clock: overrides?.clock ?? deps.clock,
    store: overrides?.store ?? createFileScheduleStore(join(deps.os.dirs.state, SCHEDULE_DIR_NAME)),
    runner: runnerOf(deps),
    ticker: overrides?.ticker ?? schedulerTickerOf(deps.os.time.scheduler),
    watcher: fileWatcherOf(deps.os, deps.logger),
    ids: scheduleIdsOf(deps.ids),
    ...(overrides?.policy === undefined ? {} : { policy: overrides.policy }),
    report: (message, fields) => {
      deps.logger.error(message, toLogFields(fields));
    },
  });
}

/** 예약 ID. IdFactory는 접두를 고정 목록으로 받으므로 `evt` ULID 본문을 빌려 `sch_`·`run_` 접두를 붙인다. 발급 원천은 같다 */
function scheduleIdsOf(ids: IdFactory): ScheduleIds {
  return {
    next: (prefix) => `${prefix}_${ids.next("evt").slice(EVENT_PREFIX_LENGTH)}`,
  };
}

/** 틱. OS 스케줄러에는 반복 타이머가 없어 한 번씩 다시 건다. 해제하면 더 걸지 않는다 */
function schedulerTickerOf(scheduler: Scheduler): ScheduleTicker {
  return {
    every(periodMs, tick) {
      const state: { stopped: boolean; handle: TimerHandle | undefined } = {
        stopped: false,
        handle: undefined,
      };
      const arm = (): void => {
        state.handle = scheduler.setTimeout(() => {
          if (state.stopped) return;
          tick();
          arm();
        }, periodMs);
      };
      arm();
      return () => {
        state.stopped = true;
        if (state.handle !== undefined) scheduler.clearTimeout(state.handle);
      };
    },
  };
}

/**
 * 파일 감시. L0.os의 `watch`가 감시 루트를 상태 디렉터리·설정·작업 폴더 같은 허용 루트 안으로만 받는다.
 * 허용 밖 경로는 경고로 남기고 그 경로만 감시하지 않는다.
 */
function fileWatcherOf(os: Pick<OsService, "watch">, logger: Logger): ScheduleWatcher {
  return {
    watch(paths, onChange): Unsubscribe {
      const state: WatchState = { closed: false, handles: [] };
      for (const path of paths) {
        detach(adoptWatch(os, path, state, onChange, logger), (caught) => {
          logger.error("schedule.watch_failed", { path, message: messageOf(caught) });
        });
      }
      return () => {
        state.closed = true;
        for (const handle of state.handles.splice(0)) {
          detach(handle.close(), (caught) => {
            logger.error("schedule.unwatch_failed", { message: messageOf(caught) });
          });
        }
      };
    },
  };
}

interface WatchState {
  closed: boolean;
  handles: WatchHandle[];
}

/** 감시 하나를 연다. 여는 사이에 구독이 거두어졌으면 바로 닫는다 */
async function adoptWatch(
  os: Pick<OsService, "watch">,
  path: string,
  state: WatchState,
  onChange: () => void,
  logger: Logger,
): Promise<void> {
  const opened = await os.watch(path, {}, () => {
    if (!state.closed) onChange();
  });
  if (!opened.ok) {
    logger.warn("schedule.watch_failed", { path, kind: opened.error.kind });
    return;
  }
  if (state.closed) {
    detach(opened.value.close(), (caught) => {
      logger.error("schedule.unwatch_failed", { message: messageOf(caught) });
    });
    return;
  }
  state.handles.push(opened.value);
}

function startFailed(message: string): RunnerFailure {
  return { kind: "start_failed", message };
}

/** 실행 thread의 제목. 요청에 제목이 없으면 프롬프트 앞부분을 쓴다(줄바꿈과 연속 공백은 한 칸으로 줄인다) */
function titleOf(request: RunRequest): string {
  if (request.title !== null) return request.title;
  const flat = request.prompt.replace(/\s+/gu, " ").trim();
  return Array.from(flat).slice(0, TITLE_CHARS).join("");
}

/** `turn.completed`의 상태를 실행 결과로 옮긴다. 승인 대기 상태는 turn 상태에 없다(미결 참조) */
function outcomeOf(payload: unknown, logger: Logger): RunOutcome {
  const parsed = parse(TurnCompletedPayloadSchema, payload);
  if (!parsed.ok) {
    logger.error("schedule.turn_payload_invalid", {});
    return "failed";
  }
  switch (parsed.value.status) {
    case "completed":
      return "completed";
    case "interrupted":
      return "aborted";
    case "failed":
      return "failed";
    default:
      return assertNever(parsed.value.status, "TurnCompleted.status");
  }
}

async function releaseLease(
  ports: ScheduleRunnerPorts,
  threadId: ThreadId,
  logger: Logger,
): Promise<void> {
  const released = await attemptAsync(() => ports.locks.release(threadId));
  if (!released.ok) {
    logger.error("schedule.release_failed", { threadId, message: messageOf(released.error.cause) });
  }
}

/** 실행 thread의 `turn.completed`를 한 번 기다린다. 받으면 구독을 거두고 결과를 낸다. `cancel`은 구독을 거둔다 */
function awaitCompletion(
  feed: EventFeedPort,
  threadId: ThreadId,
  logger: Logger,
): { readonly settled: Promise<RunOutcome>; readonly cancel: () => void } {
  const slot: { off: Unsubscribe | undefined } = { off: undefined };
  const finished = Promise.withResolvers<RunOutcome>();
  const cancel = (): void => {
    slot.off?.();
  };
  slot.off = feed.onCommit((batch) => {
    const completed = batch.events.find(
      (event) => event.threadId === threadId && event.kind === "turn.completed",
    );
    if (completed === undefined) return;
    cancel();
    finished.resolve(outcomeOf(completed.payload, logger));
  });
  return { settled: finished.promise, cancel };
}

/**
 * 실행 하나를 시작한다. 순서는 thread 만들기, 쓰기 소유 얻기, 정착 구독, 무인 입력 넣기다. 구독은 입력을 넣기 전에 건다.
 * 입력은 `whenIdle` 안에서 넣어 루프가 그 사이 다른 turn을 열지 못하게 한다. 정착하면 소유를 놓는다.
 */
function runnerOf(deps: HostScheduleDeps): ScheduleRunner {
  return {
    async start(request: RunRequest): Promise<Result<StartedRun, RunnerFailure>> {
      const ports = deps.runnerPorts();
      // 재시작 뒤 `claimed` 실행은 같은 요청으로 다시 시작한다. 생성 키가 같으므로 처음 만든 thread를 돌려받고 thread는 하나다
      // (L2.schedule §4.4.4 둘째 장치). 돌려받은 thread에는 임대를 다시 얻고 같은 요청 키로 입력을 넣는다
      const created = await attemptAsync(() =>
        ports.threads.create({
          title: titleOf(request),
          creationKey: `timer:${request.scheduleId}:${request.dueAt}:create`,
          ...(request.workspace === null ? {} : { workspace: request.workspace }),
        }),
      );
      if (!created.ok) {
        return err(startFailed(`thread create failed: ${messageOf(created.error.cause)}`));
      }
      const threadId = created.value.threadId;

      const lease = await attemptAsync(() => ports.locks.tryAcquire(threadId, deps.ownerKind));
      if (!lease.ok) return err(startFailed(`lease failed: ${messageOf(lease.error.cause)}`));
      if (!lease.value.ok) return err(startFailed("thread is owned by another process"));

      // 구독은 입력을 넣기 전에 건다. 입력이 turn을 열고 turn.completed가 그 뒤에 올 수 있다
      const completion = awaitCompletion(ports.feed, threadId, deps.logger);

      const draft: InputDraft = {
        threadId,
        mode: "followUp",
        item: { kind: "user", content: request.prompt },
        requestId: request.requestId,
        source: { type: "schedule", timerId: request.scheduleId },
      };
      const queued = await attemptAsync(() =>
        deps.loop.whenIdle(threadId, () => deps.tasks.inputs.enqueue(draft)),
      );
      if (!queued.ok) {
        completion.cancel();
        await releaseLease(ports, threadId, deps.logger);
        return err(startFailed(`input failed: ${messageOf(queued.error.cause)}`));
      }
      if (!queued.value.ok) {
        completion.cancel();
        await releaseLease(ports, threadId, deps.logger);
        return err(startFailed(`input rejected: ${queued.value.error.kind}`));
      }

      const settled = completion.settled.then(async (outcome) => {
        await releaseLease(ports, threadId, deps.logger);
        return outcome;
      });
      const started: StartedRun = { threadId, settled };
      return ok(started);
    },
  };
}
