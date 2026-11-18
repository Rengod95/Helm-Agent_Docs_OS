import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/index.ts";
import { HOOK_RUN_DECISIONS, type HookRunDecision } from "./hook-outcome.ts";

// F.wire-settings.spec §3.3.6. 계측(X-15)과 Test run 제어(X-19)가 호스트 포트(`ports.ts`의 `TraceReadPort`,
// `TestRunControlPort`)와 wire 결과(`wire/ext-read.ts`, `wire/profile-test-run.ts`)로 함께 쓰는 결과 타입이다.
// F 디렉터리 순서(extensions가 wire-settings보다 앞)를 지키려고 extensions에 두고 wire가 가져다 쓴다.

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Count = Type.Integer({ minimum: 0 });
const Ms = Type.Number({ minimum: 0 });

/** Hook × Registration 한 칸의 시간 분포(`ext.timings`) */
export interface ExtHookTiming {
  readonly hook: string;
  readonly registrationId: string;
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly failures: number;
}
const HookTimingShape = Type.Object(
  {
    hook: Name,
    registrationId: Name,
    count: Count,
    p50Ms: Ms,
    p95Ms: Ms,
    maxMs: Ms,
    failures: Count,
  },
  { additionalProperties: false },
);
export interface ExtTimingsResult {
  /** 계측(`x.operations.trace.enabled`)이 켜져 있는가. 꺼져 있으면 `timings`는 비어 있다 */
  readonly traceEnabled: boolean;
  readonly timings: readonly ExtHookTiming[];
}
const ExtTimingsResultShape = Type.Object(
  { traceEnabled: Type.Boolean(), timings: Type.Array(HookTimingShape, { maxItems: 1024 }) },
  { additionalProperties: false },
);
export const ExtTimingsResultSchema: TUnsafe<ExtTimingsResult> = Type.Unsafe<ExtTimingsResult>(
  ExtTimingsResultShape satisfies SchemaProof<ExtTimingsResult, typeof ExtTimingsResultShape>,
);

/** 핸들러 결과 다섯. 고침(modified), 지나감(passed), 막음(blocked), 실패(failed), 건너뜀(skipped) */
export const TRACE_HANDLER_RESULTS = [
  "modified",
  "passed",
  "blocked",
  "failed",
  "skipped",
] as const;
export type TraceHandlerResult = (typeof TRACE_HANDLER_RESULTS)[number];
/** `failed`의 이유. 다른 결과에서는 null */
export const TRACE_FAILURE_REASONS = [
  "threw",
  "timeout",
  "result_invalid",
  "merge_rejected",
  "process_exit",
  "process_killed",
] as const;
export type TraceFailureReason = (typeof TRACE_FAILURE_REASONS)[number];

/** 핸들러의 출처(턴 기록 `HookRun.sourceKind`와 같은 값). 외부 훅 설정의 실행은 `external_hook`, 내장 패키지는 `builtin`이다 */
export const TRACE_SOURCE_KINDS = ["plugin", "external_hook", "builtin"] as const;
export type TraceSourceKind = (typeof TRACE_SOURCE_KINDS)[number];

/** 사람 대기 메타데이터(턴 기록 `HookRun.ask`와 같은 모양). `via`가 `decision`이면 핸들러가 `{ ask: true }`를 낸 것, `awaitUser`이면 핸들러가 직접 기다린 것이다 */
export interface TraceAsk {
  readonly via: "decision" | "awaitUser";
  /** 사람을 기다린 횟수 */
  readonly waits: number;
  /** 기다린 시간 합(ms). 핸들러의 활성 시간에서 뺀 값과 같다 */
  readonly waitMs: number;
  /** 승인 요청 id. 호스트가 도구 호출의 승인에서 채운다. 알 수 없으면 null */
  readonly approvalId: string | null;
  /** 답. 호스트가 승인 해결에서 채운다. 알 수 없으면 null */
  readonly answer: "allow" | "deny" | "answer" | "cancelled" | "expired" | "noninteractive" | null;
}

export interface TraceHandlerEntry {
  readonly registrationId: string;
  readonly ms: number;
  readonly result: TraceHandlerResult;
  /** 핸들러가 시작한 시점. Turn이 처음 보인 때부터 흐른 ms */
  readonly atMs: number;
  /** 바뀐 크기. `modified`일 때 핸들러가 낸 값의 JSON 문자 수, 그 밖에는 0 */
  readonly size: number;
  /** 앞 핸들러가 멈춰서 건너뛴 경우 그 핸들러의 RegistrationId. 중단으로 건너뛰었거나 건너뛰지 않았으면 null */
  readonly skippedBy: string | null;
  /** `failed`의 이유. 그 밖에는 null */
  readonly reason: TraceFailureReason | null;
  /**
   * 도구 호출 지점(`tool.call.before`, `guard.tool.before`, `tool.result`, `tool.execution.*`)의 디스패치 키 접미에서 얻은 호출 id.
   * 그 밖의 지점이나 접미가 없는 디스패치에는 없다(생략). 턴 기록 정본 `turn-record-metrics.md` §4.2 규칙 13
   */
  readonly toolCallId?: string;
  /**
   * 등록한 플러그인(확장) 이름. 외부 훅 설정의 실행은 `external-hook:<id>`다(턴 기록 §4.2 규칙 16).
   * 기록하는 쪽이 알 때만 있다(생략 가능). 턴 기록은 없으면 `none`으로 채운다
   */
  readonly plugin?: string;
  /** 플러그인 버전 id. 로더가 아직 알려주지 않으면 null이다 */
  readonly versionId?: string | null;
  /** 출처 종류. 생략되면 턴 기록은 `plugin`으로 본다 */
  readonly sourceKind?: TraceSourceKind;
  /** 핸들러가 낸 결정값(F §4.2). 값을 내지 않았으면 `none`이다. 기록하는 쪽이 알 때만 있다 */
  readonly decision?: HookRunDecision;
  /** 사람 대기 메타데이터. 기다리지 않았고 결정도 `ask`가 아니면 생략한다 */
  readonly ask?: TraceAsk;
}
export interface TraceTurnEntry {
  readonly seq: number;
  readonly hook: string;
  readonly step: number;
  readonly handlers: readonly TraceHandlerEntry[];
  /**
   * 턴이 열리기 전에 실행된 훅(`thread.start`, `input.user.before`, `input.bash.before`)이 다음 턴의 단계 0 항목이 된 것이면 참.
   * 턴 안에서 실행된 항목에는 없다(생략). 턴 기록 `turn-record-metrics.md` §4.2 규칙 17의 2 [제안]
   */
  readonly pre?: true;
}
/** `trace.turn`의 결과(W-43) */
export interface TraceTurnResult {
  /** 계측이 켜져 있는가. 꺼져 있으면 `retained`는 거짓이고 `entries`는 비어 있다 */
  readonly traceEnabled: boolean;
  /** 링 버퍼에 남아 있으면 참. 밀려났거나 계측이 꺼져 있으면 거짓이고 `entries`는 비어 있다 */
  readonly retained: boolean;
  readonly entries: readonly TraceTurnEntry[];
}
const TraceTurnResultShape = Type.Object(
  {
    traceEnabled: Type.Boolean(),
    retained: Type.Boolean(),
    entries: Type.Array(
      Type.Object(
        {
          seq: Count,
          hook: Name,
          step: Count,
          handlers: Type.Array(
            Type.Object(
              {
                registrationId: Name,
                ms: Ms,
                result: Type.Union(TRACE_HANDLER_RESULTS.map((name) => Type.Literal(name))),
                atMs: Ms,
                size: Count,
                skippedBy: Type.Union([Name, Type.Null()]),
                reason: Type.Union([
                  ...TRACE_FAILURE_REASONS.map((name) => Type.Literal(name)),
                  Type.Null(),
                ]),
                toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
                plugin: Type.Optional(Name),
                versionId: Type.Optional(Type.Union([Name, Type.Null()])),
                sourceKind: Type.Optional(
                  Type.Union(TRACE_SOURCE_KINDS.map((kind) => Type.Literal(kind))),
                ),
                decision: Type.Optional(
                  Type.Union(HOOK_RUN_DECISIONS.map((decision) => Type.Literal(decision))),
                ),
                ask: Type.Optional(
                  Type.Object(
                    {
                      via: Type.Union([Type.Literal("decision"), Type.Literal("awaitUser")]),
                      waits: Count,
                      waitMs: Ms,
                      approvalId: Type.Union([Name, Type.Null()]),
                      answer: Type.Union([
                        Type.Literal("allow"),
                        Type.Literal("deny"),
                        Type.Literal("answer"),
                        Type.Literal("cancelled"),
                        Type.Literal("expired"),
                        Type.Literal("noninteractive"),
                        Type.Null(),
                      ]),
                    },
                    { additionalProperties: false },
                  ),
                ),
              },
              { additionalProperties: false },
            ),
            { maxItems: 256 },
          ),
          pre: Type.Optional(Type.Literal(true)),
        },
        { additionalProperties: false },
      ),
      { maxItems: 5000 },
    ),
  },
  { additionalProperties: false },
);
export const TraceTurnResultSchema: TUnsafe<TraceTurnResult> = Type.Unsafe<TraceTurnResult>(
  TraceTurnResultShape satisfies SchemaProof<TraceTurnResult, typeof TraceTurnResultShape>,
);

/** `testRun.pause|resume|step`의 결과(W-48) */
export interface TestRunControlResult {
  readonly paused: boolean;
}
const TestRunControlResultShape = Type.Object(
  { paused: Type.Boolean() },
  { additionalProperties: false },
);
export const TestRunControlResultSchema: TUnsafe<TestRunControlResult> =
  Type.Unsafe<TestRunControlResult>(
    TestRunControlResultShape satisfies SchemaProof<
      TestRunControlResult,
      typeof TestRunControlResultShape
    >,
  );

/** `testRun.phase`의 drive lock(임대) 칸. 쥔 그룹, 임대 상태, 임대 차수 */
export interface TestRunLock {
  /** 임대를 가진 그룹 확장 이름. 커밋된 임대가 없으면 null */
  readonly holder: string | null;
  /** `active`: 쓰는 중. `releasing`: 반납이 정해져 다음 경계에서 커밋된다. `none`: 커밋된 임대가 없다 */
  readonly status: "active" | "releasing" | "none";
  /** 임대 차수(`leaseEpoch`). 커밋된 임대가 없으면 null */
  readonly epoch: number | null;
}
const TestRunLockShape = Type.Object(
  {
    holder: Type.Union([Name, Type.Null()]),
    status: Type.Union([Type.Literal("active"), Type.Literal("releasing"), Type.Literal("none")]),
    epoch: Type.Union([Count, Type.Null()]),
  },
  { additionalProperties: false },
);

/** 단계 경계 기록 한 건. 호스트가 thread마다 최근 것만 남긴다 */
export interface TestRunBoundary {
  /** 그 경계의 상태 revision */
  readonly seq: number;
  /** 그 경계에서 커밋된 `phase`. 없으면 null */
  readonly phase: string | null;
  /** 그 경계에서 멈춰 기다렸는가(멈춤 요청이 걸려 있었는가) */
  readonly paused: boolean;
}
const TestRunBoundaryShape = Type.Object(
  {
    seq: Count,
    phase: Type.Union([Name, Type.Null()]),
    paused: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** `testRun.phase`의 결과(W-50). 단계 이름, 멈춤, drive lock, 가드 계수, 단계 경계 기록을 함께 준다 */
export interface TestRunPhaseResult {
  /** Test run 대화에서 `grp.<id>.state.committed`의 `phase`만. 없으면 null */
  readonly phase: string | null;
  /** `phase`를 읽은 그룹 확장 이름. `phase`가 없으면 null */
  readonly group: string | null;
  readonly seq: number | null;
  /** 이 대화에 멈춤 요청이 걸려 있는가. 참이면 다음 단계 경계에서 멈춘다 */
  readonly paused: boolean;
  /** drive lock. 멈춘 동안에도 보유자가 쥐고 있다 */
  readonly lock: TestRunLock;
  /** 이 대화의 계측 기록에서 핸들러 결과가 `blocked`인 수. 계측이 꺼져 있으면 0 */
  readonly guardHits: number;
  /** `guardHits`가 측정된 값인가(`x.operations.trace.enabled`). 거짓이면 화면은 "측정 꺼짐"을 보인다 */
  readonly traceEnabled: boolean;
  /** 호스트가 남긴 최근 단계 경계 기록. 오래된 것부터 새것 순이라 마지막이 가장 최근이다. 최대 200개 */
  readonly boundaries: readonly TestRunBoundary[];
}
const TestRunPhaseResultShape = Type.Object(
  {
    phase: Type.Union([Name, Type.Null()]),
    group: Type.Union([Name, Type.Null()]),
    seq: Type.Union([Count, Type.Null()]),
    paused: Type.Boolean(),
    lock: TestRunLockShape,
    guardHits: Count,
    traceEnabled: Type.Boolean(),
    boundaries: Type.Array(TestRunBoundaryShape, { maxItems: 200 }),
  },
  { additionalProperties: false },
);
export const TestRunPhaseResultSchema: TUnsafe<TestRunPhaseResult> =
  Type.Unsafe<TestRunPhaseResult>(
    TestRunPhaseResultShape satisfies SchemaProof<
      TestRunPhaseResult,
      typeof TestRunPhaseResultShape
    >,
  );

/** Test run 제어가 실패한 이유. `kind`가 있는 값이다 */
export interface TestRunControlError {
  /** not_a_test_run: Test run 대화가 아님. not_paused: 멈춰 있지 않음(resume, step). not_available: 이 호스트에 제어 구현이 없음 */
  readonly kind: "not_a_test_run" | "not_paused" | "not_available";
}
