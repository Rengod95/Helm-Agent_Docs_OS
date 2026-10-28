import { err, ok, type Result } from "@xeon/contracts";
import {
  createScheduleService,
  EMPTY_STATE,
  type RunOutcome,
  type RunRequest,
  type RunnerFailure,
  type ScheduleDeps,
  type ScheduleService,
  type ScheduleState,
  type StartedRun,
  type StoreFailure,
} from "../../src/index.ts";

export const SECOND: number = 1000;
export const MINUTE: number = 60 * SECOND;
export const HOUR: number = 60 * MINUTE;

/** 메모리 저장소. `saved`는 마지막으로 쓴 상태다(재시작 시험이 같은 객체를 새 서비스에 넘긴다) */
export class MemoryStore {
  saved: ScheduleState;
  saves = 0;
  failSaves = false;
  constructor(initial: ScheduleState = EMPTY_STATE) {
    this.saved = initial;
  }
  load(): Promise<Result<ScheduleState, StoreFailure>> {
    return Promise.resolve(ok(this.saved));
  }
  save(state: ScheduleState): Promise<Result<void, StoreFailure>> {
    if (this.failSaves) return Promise.resolve(err({ kind: "store_failed", message: "disk full" }));
    this.saved = state;
    this.saves += 1;
    return Promise.resolve(ok(undefined));
  }
}

export interface PendingRun {
  readonly request: RunRequest;
  settle(outcome: RunOutcome): void;
}

export class FakeRunner {
  readonly started: PendingRun[] = [];
  failNext = false;
  start(request: RunRequest): Promise<Result<StartedRun, RunnerFailure>> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.resolve(err({ kind: "start_failed", message: "no model" }));
    }
    const settled = Promise.withResolvers<RunOutcome>();
    this.started.push({ request, settle: (outcome) => settled.resolve(outcome) });
    return Promise.resolve(
      ok({ threadId: `thr_${this.started.length}`, settled: settled.promise }),
    );
  }
}

export interface Harness {
  readonly service: ScheduleService;
  readonly store: MemoryStore;
  readonly runner: FakeRunner;
  readonly clock: { now: number };
  /** 등록된 틱 주기. 시험이 직접 `service.tick()`을 부른다 */
  readonly ticks: { periods: number[]; stopped: number };
  /** `watch`로 등록된 경로 묶음과 변경 신호 */
  readonly watches: { paths: readonly string[]; fire: () => void; closed: boolean }[];
}

export function createHarness(
  options: {
    readonly store?: MemoryStore;
    readonly clock?: { now: number };
    readonly policy?: ScheduleDeps["policy"];
  } = {},
): Harness {
  const store = options.store ?? new MemoryStore();
  const runner = new FakeRunner();
  const clock = options.clock ?? { now: 1_000_000_000_000 };
  const periods: number[] = [];
  const ticks = { periods, stopped: 0 };
  const watches: Harness["watches"] = [];
  let counter = 0;
  const service = createScheduleService({
    clock: { now: () => clock.now },
    store,
    runner,
    ticker: {
      every: (period) => {
        ticks.periods.push(period);
        return () => {
          ticks.stopped += 1;
        };
      },
    },
    watcher: {
      watch: (paths, onChange) => {
        const watch = { paths, fire: onChange, closed: false };
        watches.push(watch);
        return () => {
          watch.closed = true;
        };
      },
    },
    ids: {
      next: (prefix) => {
        counter += 1;
        return `${prefix}_${counter}`;
      },
    },
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
  return { service, store, runner, clock, ticks, watches };
}
