import { Type, type TSchema, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof } from "../../base/index.ts";
import { JsonValueSchema, localIdPattern, type JsonValue } from "../../conversation/index.ts";
import type { CatalogEntry } from "./entry.ts";

// L2.schedule.spec §3.7. 소유 생산자 cap.schedule은 owners.ts가 정한다. 모두 내구, 버전 1이다.
// 모든 이벤트는 세션 이벤트이고 envelope threadId가 대상 세션이다. 정적 타입은 스키마에서 파생한다(Static).

const LoopId = Type.String({ pattern: localIdPattern("lop") });
const WakeupId = Type.String({ pattern: localIdPattern("wak") });
const TimerId = Type.String({ pattern: localIdPattern("tmr") });
const WatchId = Type.String({ pattern: localIdPattern("wch") });
const RequestId = Type.String({ minLength: 1, maxLength: 256 });
const EpochMs = Type.Integer({ minimum: 0 });
const Count = Type.Integer({ minimum: 0 });
const DeliverWhen = Type.Union([
  Type.Literal("steer"),
  Type.Literal("followUp"),
  Type.Literal("next"),
]);

function exact<P extends Parameters<typeof Type.Object>[0]>(
  properties: P,
): ReturnType<typeof Type.Object<P>> {
  return Type.Object(properties, { additionalProperties: false });
}

const loopStartedShape = exact({
  loopId: LoopId,
  prompt: Type.String({ maxLength: 20000 }),
  until: Type.Union([
    exact({ type: Type.Literal("count"), iterations: Type.Integer({ minimum: 1 }) }),
    exact({ type: Type.Literal("duration"), seconds: Type.Integer({ minimum: 1 }) }),
    exact({
      type: Type.Literal("shell"),
      command: Type.String({ minLength: 1, maxLength: 4000 }),
      cwd: Nullable(Type.String({ maxLength: 4096 })),
      successExitCode: Type.Integer(),
      timeoutSeconds: Type.Integer({ minimum: 1 }),
    }),
    exact({ type: Type.Literal("model") }),
  ]),
  interval: Type.Union([
    exact({ type: Type.Literal("fixed"), seconds: Type.Integer({ minimum: 1 }) }),
    exact({ type: Type.Literal("self") }),
  ]),
  maxIterations: Type.Integer({ minimum: 1 }),
  /** epoch ms. 시작 커밋 전에 주입 시계로 계산한다 */
  expiresAt: EpochMs,
  goalId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  /** "user" | "model" | "x.<ext>" | "grp.<group>" */
  startedBy: Type.String({ minLength: 1, maxLength: 64 }),
});
export type LoopStartedPayload = {
  loopId: string;
  prompt: string;
  until:
    | { type: "count"; iterations: number }
    | { type: "duration"; seconds: number }
    | {
        type: "shell";
        command: string;
        cwd: string | null;
        successExitCode: number;
        timeoutSeconds: number;
      }
    | { type: "model" };
  interval: { type: "fixed"; seconds: number } | { type: "self" };
  maxIterations: number;
  expiresAt: number;
  goalId: string | null;
  startedBy: string;
};
export const LoopStartedPayloadSchema: TUnsafe<LoopStartedPayload> =
  Type.Unsafe<LoopStartedPayload>(
    loopStartedShape satisfies SchemaProof<LoopStartedPayload, typeof loopStartedShape>,
  );

const loopIteratedShape = exact({
  loopId: LoopId,
  iteration: Type.Integer({ minimum: 1 }),
  requestId: RequestId,
});
export type LoopIteratedPayload = { loopId: string; iteration: number; requestId: string };
export const LoopIteratedPayloadSchema: TUnsafe<LoopIteratedPayload> =
  Type.Unsafe<LoopIteratedPayload>(
    loopIteratedShape satisfies SchemaProof<LoopIteratedPayload, typeof loopIteratedShape>,
  );

const loopStoppedShape = exact({
  loopId: LoopId,
  reason: Type.Union([
    Type.Literal("count"),
    Type.Literal("duration"),
    Type.Literal("shell"),
    Type.Literal("model"),
    Type.Literal("goal"),
    Type.Literal("max_iterations"),
    Type.Literal("expired"),
    Type.Literal("user"),
    Type.Literal("host_exit"),
    Type.Literal("error"),
  ]),
  iterations: Count,
  /** shell 종료 코드, 오류 요약 등 */
  detail: Nullable(Type.String({ maxLength: 500 })),
});
export type LoopStoppedPayload = {
  loopId: string;
  reason:
    | "count"
    | "duration"
    | "shell"
    | "model"
    | "goal"
    | "max_iterations"
    | "expired"
    | "user"
    | "host_exit"
    | "error";
  iterations: number;
  detail: string | null;
};
export const LoopStoppedPayloadSchema: TUnsafe<LoopStoppedPayload> =
  Type.Unsafe<LoopStoppedPayload>(
    loopStoppedShape satisfies SchemaProof<LoopStoppedPayload, typeof loopStoppedShape>,
  );

const wakeupScheduledShape = exact({
  wakeupId: WakeupId,
  dueAt: EpochMs,
  prompt: Type.String({ maxLength: 20000 }),
  loopId: Nullable(LoopId),
  toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
  /** 대체한 이전 wakeupId */
  replaces: Nullable(WakeupId),
});
export type WakeupScheduledPayload = {
  wakeupId: string;
  dueAt: number;
  prompt: string;
  loopId: string | null;
  toolCallId: string | null;
  replaces: string | null;
};
export const WakeupScheduledPayloadSchema: TUnsafe<WakeupScheduledPayload> =
  Type.Unsafe<WakeupScheduledPayload>(
    wakeupScheduledShape satisfies SchemaProof<WakeupScheduledPayload, typeof wakeupScheduledShape>,
  );

const wakeupFiredShape = exact({ wakeupId: WakeupId, requestId: RequestId, firedAt: EpochMs });
export type WakeupFiredPayload = { wakeupId: string; requestId: string; firedAt: number };
export const WakeupFiredPayloadSchema: TUnsafe<WakeupFiredPayload> =
  Type.Unsafe<WakeupFiredPayload>(
    wakeupFiredShape satisfies SchemaProof<WakeupFiredPayload, typeof wakeupFiredShape>,
  );

const wakeupCancelledShape = exact({
  wakeupId: WakeupId,
  reason: Type.Union([
    Type.Literal("replaced"),
    Type.Literal("loop_stopped"),
    Type.Literal("host_exit"),
    Type.Literal("user"),
  ]),
});
export type WakeupCancelledPayload = {
  wakeupId: string;
  reason: "replaced" | "loop_stopped" | "host_exit" | "user";
};
export const WakeupCancelledPayloadSchema: TUnsafe<WakeupCancelledPayload> =
  Type.Unsafe<WakeupCancelledPayload>(
    wakeupCancelledShape satisfies SchemaProof<WakeupCancelledPayload, typeof wakeupCancelledShape>,
  );

const timerCreatedShape = exact({
  timerId: TimerId,
  spec: Type.Union([
    exact({
      type: Type.Literal("cron"),
      expr: Type.String({ minLength: 1, maxLength: 256 }),
      tz: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    }),
    exact({ type: Type.Literal("at"), at: Type.String({ minLength: 1, maxLength: 64 }) }),
  ]),
  title: Nullable(Type.String({ maxLength: 200 })),
  missed: Type.Union([Type.Literal("skip"), Type.Literal("once"), Type.Literal("all")]),
});
export type TimerCreatedPayload = {
  timerId: string;
  spec: { type: "cron"; expr: string; tz: string | null } | { type: "at"; at: string };
  title: string | null;
  missed: "skip" | "once" | "all";
};
export const TimerCreatedPayloadSchema: TUnsafe<TimerCreatedPayload> =
  Type.Unsafe<TimerCreatedPayload>(
    timerCreatedShape satisfies SchemaProof<TimerCreatedPayload, typeof timerCreatedShape>,
  );

const timerCancelledShape = exact({ timerId: TimerId });
export type TimerCancelledPayload = { timerId: string };
export const TimerCancelledPayloadSchema: TUnsafe<TimerCancelledPayload> =
  Type.Unsafe<TimerCancelledPayload>(
    timerCancelledShape satisfies SchemaProof<TimerCancelledPayload, typeof timerCancelledShape>,
  );

const runStartedShape = exact({
  timerId: TimerId,
  dueAt: EpochMs,
  firedAt: EpochMs,
  /** 놓친 기한을 따라잡은 실행이면 참 */
  missed: Type.Boolean(),
  /** 예약 세션 표식. L3 그룹이 예약 세션에서 자기 동작을 줄이는 근거로 읽는다 */
  origin: Type.Literal("timer"),
  /** timer:<timerId>:<dueAt> */
  requestId: RequestId,
});
export type RunStartedPayload = {
  timerId: string;
  dueAt: number;
  firedAt: number;
  missed: boolean;
  origin: "timer";
  requestId: string;
};
export const RunStartedPayloadSchema: TUnsafe<RunStartedPayload> = Type.Unsafe<RunStartedPayload>(
  runStartedShape satisfies SchemaProof<RunStartedPayload, typeof runStartedShape>,
);

const runStalledShape = exact({ timerId: TimerId, dueAt: EpochMs, idleSeconds: Count });
export type RunStalledPayload = { timerId: string; dueAt: number; idleSeconds: number };
export const RunStalledPayloadSchema: TUnsafe<RunStalledPayload> = Type.Unsafe<RunStalledPayload>(
  runStalledShape satisfies SchemaProof<RunStalledPayload, typeof runStalledShape>,
);

const runFinishedShape = exact({
  timerId: TimerId,
  dueAt: EpochMs,
  outcome: Type.Union([
    Type.Literal("completed"),
    Type.Literal("aborted"),
    Type.Literal("failed"),
    Type.Literal("awaiting_approval"),
  ]),
});
export type RunFinishedPayload = {
  timerId: string;
  dueAt: number;
  outcome: "completed" | "aborted" | "failed" | "awaiting_approval";
};
export const RunFinishedPayloadSchema: TUnsafe<RunFinishedPayload> =
  Type.Unsafe<RunFinishedPayload>(
    runFinishedShape satisfies SchemaProof<RunFinishedPayload, typeof runFinishedShape>,
  );

const watchStartedShape = exact({
  watchId: WatchId,
  source: JsonValueSchema,
  filter: JsonValueSchema,
  notify: DeliverWhen,
  maxMatches: Type.Integer({ minimum: 1 }),
});
export type WatchStartedPayload = {
  watchId: string;
  source: JsonValue;
  filter: JsonValue;
  notify: "steer" | "followUp" | "next";
  maxMatches: number;
};
export const WatchStartedPayloadSchema: TUnsafe<WatchStartedPayload> =
  Type.Unsafe<WatchStartedPayload>(
    watchStartedShape satisfies SchemaProof<WatchStartedPayload, typeof watchStartedShape>,
  );

const watchMatchedShape = exact({
  watchId: WatchId,
  match: Type.Integer({ minimum: 1 }),
  requestId: RequestId,
  /** 500자 이하, 마스킹 후 */
  excerpt: Type.String({ maxLength: 500 }),
});
export type WatchMatchedPayload = {
  watchId: string;
  match: number;
  requestId: string;
  excerpt: string;
};
export const WatchMatchedPayloadSchema: TUnsafe<WatchMatchedPayload> =
  Type.Unsafe<WatchMatchedPayload>(
    watchMatchedShape satisfies SchemaProof<WatchMatchedPayload, typeof watchMatchedShape>,
  );

const watchStoppedShape = exact({
  watchId: WatchId,
  reason: Type.Union([
    Type.Literal("user"),
    Type.Literal("max_matches"),
    Type.Literal("source_ended"),
    Type.Literal("host_exit"),
  ]),
});
export type WatchStoppedPayload = {
  watchId: string;
  reason: "user" | "max_matches" | "source_ended" | "host_exit";
};
export const WatchStoppedPayloadSchema: TUnsafe<WatchStoppedPayload> =
  Type.Unsafe<WatchStoppedPayload>(
    watchStoppedShape satisfies SchemaProof<WatchStoppedPayload, typeof watchStoppedShape>,
  );

const remoteRespondedShape = exact({
  approvalId: Type.String({ minLength: 1, maxLength: 128 }),
  clientId: Type.String({ minLength: 1, maxLength: 128 }),
  decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
  remember: Nullable(Type.Union([Type.Literal("once"), Type.Literal("thread")])),
});
export type RemoteRespondedPayload = {
  approvalId: string;
  clientId: string;
  decision: "allow" | "deny" | "answer";
  remember: "once" | "thread" | null;
};
export const RemoteRespondedPayloadSchema: TUnsafe<RemoteRespondedPayload> =
  Type.Unsafe<RemoteRespondedPayload>(
    remoteRespondedShape satisfies SchemaProof<RemoteRespondedPayload, typeof remoteRespondedShape>,
  );

function durable(kind: `schedule.${string}`, payload: TSchema): CatalogEntry {
  return { kind, version: 1, durable: true, payload };
}

/** 도메인 소유 카탈로그(F.records.spec §3.3.2). 모두 내구, 버전 1, 생산자 cap.schedule */
export const SCHEDULE_EVENT_CATALOG: readonly CatalogEntry[] = [
  durable("schedule.loop_started", LoopStartedPayloadSchema),
  durable("schedule.loop_iterated", LoopIteratedPayloadSchema),
  durable("schedule.loop_stopped", LoopStoppedPayloadSchema),
  durable("schedule.wakeup_scheduled", WakeupScheduledPayloadSchema),
  durable("schedule.wakeup_fired", WakeupFiredPayloadSchema),
  durable("schedule.wakeup_cancelled", WakeupCancelledPayloadSchema),
  durable("schedule.timer_created", TimerCreatedPayloadSchema),
  durable("schedule.timer_cancelled", TimerCancelledPayloadSchema),
  durable("schedule.run_started", RunStartedPayloadSchema),
  durable("schedule.run_stalled", RunStalledPayloadSchema),
  durable("schedule.run_finished", RunFinishedPayloadSchema),
  durable("schedule.watch_started", WatchStartedPayloadSchema),
  durable("schedule.watch_matched", WatchMatchedPayloadSchema),
  durable("schedule.watch_stopped", WatchStoppedPayloadSchema),
  durable("schedule.remote_responded", RemoteRespondedPayloadSchema),
];
