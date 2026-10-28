import type { Result } from "@xeon/contracts";
import type { Unsubscribe } from "@xeon/contracts/extensions";

// L2.schedule.spec 4.4 (timer), 4.1 (loop). M3b B1-SCH: the schedule state machine behind ports.
// Wire/capability definitions (F) are not part of this package yet; the host owns the ports.

/** 무인 예약 실행이 만드는 세션의 종류(M3-new-12 cron 세션 종류). 세션 메타 origin과 같은 값이다 */
export const CRON_SESSION_KIND = "cron" as const;

/** 최소 간격 300초(M3-REQ-93, D-M3-13 행 3) */
export const MIN_INTERVAL_SECONDS = 300;

export type TriggerSpec =
  /** 타이머: 일정한 간격으로 반복 */
  | { readonly kind: "interval"; readonly everySeconds: number }
  /** 타이머: 한 번 */
  | { readonly kind: "at"; readonly atMs: number }
  /** 파일 감시: 경로가 바뀌면 실행. 디바운스 뒤 한 번 */
  | { readonly kind: "file_watch"; readonly paths: readonly string[]; readonly debounceMs: number }
  /** 원격: `fire`가 불릴 때만 실행(원격 클라이언트의 호출) */
  | { readonly kind: "remote" }
  /** 루프: 실행이 정착한 뒤 `intervalSeconds` 뒤에 같은 프롬프트를 다시 실행. 상한 둘이 필수 */
  | {
      readonly kind: "loop";
      readonly intervalSeconds: number;
      readonly maxIterations: number;
      readonly expiresAtMs: number;
    };

export type TriggerKind = TriggerSpec["kind"];

export type StopReason =
  | "cancelled"
  | "completed"
  | "max_iterations"
  | "expired"
  | "host_exit"
  | "run_failed";

export interface ScheduleEntry {
  readonly id: string;
  readonly trigger: TriggerSpec;
  readonly prompt: string;
  readonly workspace: string | null;
  readonly title: string | null;
  readonly sessionKind: typeof CRON_SESSION_KIND;
  readonly enabled: boolean;
  readonly createdAt: number;
  /** 다음 기한(epoch ms). interval, at, loop만 가진다. 실행 중인 루프와 꺼진 항목은 null */
  readonly nextDueAt: number | null;
  /** 마지막으로 시작한 실행의 시작 시각. 최소 간격 판정의 기준 */
  readonly lastStartedAt: number | null;
  /** 루프가 시작한 반복 수 */
  readonly iterations: number;
  readonly stoppedReason: StopReason | null;
}

export type RunStatus = "claimed" | "started" | "finished" | "skipped" | "failed";
export type RunOutcome = "completed" | "aborted" | "failed" | "awaiting_approval";
export type RunSkipReason = "missed" | "too_old" | "min_interval" | "overlap" | "rate_limited";
export type RunFailReason = "host_exit" | "start_failed" | "run_failed";

export interface RunRecord {
  readonly runId: string;
  readonly scheduleId: string;
  readonly firedBy: TriggerKind;
  readonly dueAt: number;
  /** 기한을 잡은 시각(claim). 시간당 상한 판정의 기준 */
  readonly claimedAt: number;
  /** 놓친 기한을 따라잡는 실행인가 */
  readonly missed: boolean;
  readonly status: RunStatus;
  readonly threadId: string | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly outcome: RunOutcome | null;
  /** skipped, failed의 사유. skipped 요약 기록은 `skippedCount`가 1보다 클 수 있다 */
  readonly reason: RunSkipReason | RunFailReason | null;
  readonly skippedCount: number;
}

export interface ScheduleState {
  readonly version: 1;
  readonly entries: readonly ScheduleEntry[];
  /** 오래된 것부터. `maxRunRecords`를 넘으면 앞에서 버린다 */
  readonly runs: readonly RunRecord[];
}

export const EMPTY_STATE: ScheduleState = { version: 1, entries: [], runs: [] };

export interface SchedulePolicy {
  /** 기한 뒤 이 시간 안에 처리하면 제때 실행이다(spec 4.4.4 lateGraceSeconds 기본 120) */
  readonly lateGraceMs: number;
  /** 이보다 오래된 기한은 정책과 무관하게 건너뛴다(maxCatchUpHours 기본 24) */
  readonly maxCatchUpMs: number;
  /** 최소 간격(기본 300초) */
  readonly minIntervalMs: number;
  /** 켜진 예약 수 상한 */
  readonly maxActive: number;
  /** 최근 한 시간에 시작할 수 있는 실행 수 */
  readonly maxRunsPerHour: number;
  /** 보관하는 실행 기록 수 */
  readonly maxRunRecords: number;
  /** 틱 주기 */
  readonly tickMs: number;
}

export const DEFAULT_POLICY: SchedulePolicy = {
  lateGraceMs: 120_000,
  maxCatchUpMs: 24 * 3_600_000,
  minIntervalMs: MIN_INTERVAL_SECONDS * 1000,
  maxActive: 100,
  maxRunsPerHour: 20,
  maxRunRecords: 500,
  tickMs: 15_000,
};

// ── 포트 ──────────────────────────────────────────────────────────────

export interface StoreFailure {
  readonly kind: "store_failed";
  readonly message: string;
}

/** 상태 영속화. 호스트가 파일(상태 디렉터리)로 구현한다. 재시작 뒤에도 항목과 기록이 남는다 */
export interface ScheduleStore {
  load(): Promise<Result<ScheduleState, StoreFailure>>;
  save(state: ScheduleState): Promise<Result<void, StoreFailure>>;
}

export interface RunRequest {
  readonly scheduleId: string;
  readonly runId: string;
  readonly dueAt: number;
  readonly firedBy: TriggerKind;
  readonly prompt: string;
  readonly workspace: string | null;
  readonly title: string | null;
  readonly sessionKind: typeof CRON_SESSION_KIND;
  /** 멱등 키 `<scheduleId>:<dueAt>` 꼴. 재시작 뒤 같은 요청을 다시 보내도 세션과 입력이 하나만 생긴다 */
  readonly requestId: string;
}

export interface StartedRun {
  readonly threadId: string;
  /** turn이 정착하면 이행한다. 거부하지 않는다 */
  readonly settled: Promise<RunOutcome>;
}

export interface RunnerFailure {
  readonly kind: "start_failed";
  readonly message: string;
}

/** 세션을 만들고 프롬프트를 무인(비대화) 입력으로 넣는다 */
export interface ScheduleRunner {
  start(request: RunRequest): Promise<Result<StartedRun, RunnerFailure>>;
}

export interface ScheduleClock {
  now(): number;
}

/** 틱 구동. 호스트가 OS 타이머로 구현하고 시험은 수동으로 구현한다 */
export interface ScheduleTicker {
  every(periodMs: number, tick: () => void): Unsubscribe;
}

/** 파일 감시. 경로 하나가 바뀔 때마다 `onChange`가 불린다 */
export interface ScheduleWatcher {
  watch(paths: readonly string[], onChange: () => void): Unsubscribe;
}

export interface ScheduleIds {
  next(prefix: "sch" | "run"): string;
}

export interface ScheduleDeps {
  readonly clock: ScheduleClock;
  readonly store: ScheduleStore;
  readonly runner: ScheduleRunner;
  readonly ticker: ScheduleTicker;
  readonly watcher: ScheduleWatcher;
  readonly ids: ScheduleIds;
  readonly policy?: Partial<SchedulePolicy>;
  readonly report?: (message: string, fields: Readonly<Record<string, unknown>>) => void;
}

// ── 서비스 ────────────────────────────────────────────────────────────

export interface CreateInput {
  readonly trigger: TriggerSpec;
  readonly prompt: string;
  readonly workspace?: string;
  readonly title?: string;
  /** 생략하면 켠다 */
  readonly enabled?: boolean;
}

export type CreateError =
  | { readonly kind: "interval_too_short"; readonly minSeconds: number }
  | { readonly kind: "at_in_past" }
  | { readonly kind: "invalid_trigger"; readonly reason: string }
  | { readonly kind: "limit_reached"; readonly max: number }
  | StoreFailure;

export type FireError =
  | { readonly kind: "not_found" }
  | { readonly kind: "not_remote" }
  | { readonly kind: "disabled" }
  | StoreFailure;

export type CancelError = { readonly kind: "not_found" } | StoreFailure;

export interface ScheduleService {
  create(input: CreateInput): Promise<Result<ScheduleEntry, CreateError>>;
  list(): readonly ScheduleEntry[];
  cancel(scheduleId: string): Promise<Result<ScheduleEntry, CancelError>>;
  runs(scheduleId: string, limit?: number): readonly RunRecord[];
  /** 원격 트리거. 원격 클라이언트의 호출이 부른다 */
  fire(scheduleId: string): Promise<Result<RunRecord, FireError>>;
  /** 저장소를 읽고 복구한 뒤 틱과 감시를 시작한다. 이미 돌고 있으면 아무것도 하지 않는다 */
  start(): Promise<Result<void, StoreFailure>>;
  /** 틱과 감시를 멈춘다. 진행 중인 실행은 멈추지 않는다 */
  stop(): void;
  /** 틱 한 번. 시험과 호스트가 직접 부를 수 있다 */
  tick(): Promise<void>;
  /** 켜진 타이머·파일 감시 항목 수 + claimed·started 실행 수. `ActivitySnapshot.pendingSchedules`에 쓴다 */
  pendingSchedules(): number;
  /** 켜진 루프 수. `ActivitySnapshot.liveTasks`에 더한다(M3-10) */
  liveSchedulerTasks(): number;
  onChange(listener: () => void): Unsubscribe;
  /** 진행 중 저장을 기다린다 */
  close(): Promise<void>;
}
