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

/**
 * 메모리 저장소. `saved`는 마지막으로 성공해 쓴 상태다(재시작 시험이 같은 객체를 새 서비스에 넘긴다).
 * `saves`와 `loads`는 호출 횟수다(실패한 호출도 센다). `loadFailure`는 손상된 파일 대역, `loadThrows`는 던지는 읽기 대역이다.
 */
export class MemoryStore {
  saved: ScheduleState;
  saves = 0;
  loads = 0;
  failSaves = false;
  saveThrows = false;
  loadFailure: StoreFailure | null = null;
  loadThrows = false;
  constructor(initial: ScheduleState = EMPTY_STATE) {
    this.saved = initial;
  }
  load(): Promise<Result<ScheduleState, StoreFailure>> {
    this.loads += 1;
    if (this.loadThrows) return Promise.reject(new Error("load exploded"));
    if (this.loadFailure !== null) return Promise.resolve(err(this.loadFailure));
    return Promise.resolve(ok(this.saved));
  }
  save(state: ScheduleState): Promise<Result<void, StoreFailure>> {
    this.saves += 1;
    if (this.saveThrows) return Promise.reject(new Error("save exploded"));
    if (this.failSaves) return Promise.resolve(err({ kind: "store_failed", message: "disk full" }));
    this.saved = state;
    return Promise.resolve(ok(undefined));
  }
}

interface PendingRun {
  readonly request: RunRequest;
  settle(outcome: RunOutcome): void;
}

class FakeRunner {
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
    /** 새 id의 시작 번호 뒤부터 센다. 저장소에 이미 있는 항목과 id가 겹치지 않게 한다 */
    readonly idStart?: number;
  } = {},
): Harness {
  const store = options.store ?? new MemoryStore();
  const runner = new FakeRunner();
  const clock = options.clock ?? { now: 1_000_000_000_000 };
  const periods: number[] = [];
  const ticks = { periods, stopped: 0 };
  const watches: Harness["watches"] = [];
  let counter = options.idStart ?? 0;
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
