import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../base/index.ts";

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

export const TRACE_HANDLER_RESULTS = ["ok", "error", "over_budget", "denied", "skipped"] as const;
export type TraceHandlerResult = (typeof TRACE_HANDLER_RESULTS)[number];
export interface TraceHandlerEntry {
  readonly registrationId: string;
  readonly ms: number;
  readonly result: TraceHandlerResult;
}
export interface TraceTurnEntry {
  readonly seq: number;
  readonly hook: string;
  readonly step: number;
  readonly handlers: readonly TraceHandlerEntry[];
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
              },
              { additionalProperties: false },
            ),
            { maxItems: 256 },
          ),
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

/** `testRun.phase`의 결과(W-50) */
export interface TestRunPhaseResult {
  /** Test run 대화에서 `grp.<id>.state.committed`의 `phase`만. 없으면 null */
  readonly phase: string | null;
  readonly group: string | null;
  readonly seq: number | null;
}
const TestRunPhaseResultShape = Type.Object(
  {
    phase: Type.Union([Name, Type.Null()]),
    group: Type.Union([Name, Type.Null()]),
    seq: Type.Union([Count, Type.Null()]),
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
