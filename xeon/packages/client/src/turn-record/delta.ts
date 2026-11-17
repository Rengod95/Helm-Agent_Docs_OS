import { assertNever } from "@fresnel/contracts";
import { hookOutcomeOf, type HookOutcomeOrSkipped } from "@fresnel/contracts/extensions";
import type {
  CallRecord,
  DeltaRow,
  FrameMark,
  HookRun,
  StepRecord,
  TurnChild,
  TurnRecord,
} from "@fresnel/contracts/wire";

// 화면이 쓰는 순수 함수 둘: 기록된 훅 값의 표시값과, 알림 행을 턴 기록 누적본에 넣는 함수.
// 둘 다 입력을 바꾸지 않는다(TY-15).

/**
 * 훅 기록 한 줄의 표시값(F §4.5, `hookOutcomeOf`). 여섯 값과 건너뜀(일곱째)이다.
 * 표는 `result`, `reason`, `decision`만 본다. 물음 메타데이터 `ask`는 표시값을 바꾸지 않는다.
 */
export function hookDisplayOutcomeOf(
  run: Pick<HookRun, "result" | "reason" | "decision">,
): HookOutcomeOrSkipped {
  // 기록의 `reason`은 없으면 null이고, 변환 함수의 매개변수는 생략이다(exactOptionalPropertyTypes)
  return hookOutcomeOf({
    result: run.result,
    decision: run.decision,
    ...(run.reason === null ? {} : { reason: run.reason }),
  });
}

/**
 * 행 하나를 적용한 결과. `orphan`이면 행이 가리키는 단계나 호출이 누적본에 없어 행을 버렸다.
 * 화면은 `turnRecord.get`으로 턴을 다시 읽는다.
 */
export interface DeltaApplied {
  readonly record: TurnRecord;
  readonly orphan: boolean;
}

/**
 * 알림 행 하나를 턴 기록 누적본에 넣는다.
 * - `step`: 그 단계의 전체 기록으로 바꾼다(단계 번호로 찾고, 없으면 끼운다. 단계 순서를 지킨다)
 * - `hook`: `stepIndex`가 null이면 `turnHooks`, 있으면 단계의 `hooks`(도구 호출에 묶였으면 그 호출의 `hooks`)
 * - `call`: 단계의 `calls`에서 `toolCallId`가 같은 것을 바꾸거나 붙인다
 * - `frame`: `leaseId`(없으면 깊이와 들어간 시각)가 같은 것을 바꾼다
 * - `child`: `childThreadId`가 같은 것을 바꾼다
 * - `turn`: 상태와 완료 여부를 바꾼다
 * 키로 넣으므로 같은 행을 두 번 넣어도 결과가 같다. 단계 행이 먼저 오고 그 단계의 훅과 호출 행이 뒤따르는 순서와 맞는다.
 */
export function applyDeltaRow(record: TurnRecord, row: DeltaRow): DeltaApplied {
  switch (row.kind) {
    case "step":
      return applied({ ...record, steps: upsertStep(record.steps, row.step) });
    case "hook":
      return applyHook(record, row.stepIndex, row.hook);
    case "call":
      return applyCall(record, row.stepIndex, row.call);
    case "frame":
      return applied({ ...record, frames: upsertBy(record.frames, frameKeyOf, row.frame) });
    case "child":
      return applied({ ...record, children: upsertBy(record.children, childKeyOf, row.child) });
    case "turn":
      return applied({ ...record, status: row.status, complete: row.complete });
    default:
      return assertNever(row, "DeltaRow");
  }
}

/** 행 여럿을 차례로 넣는다. `orphans`는 버린 행 수다 */
export function applyDeltaRows(
  record: TurnRecord,
  rows: readonly DeltaRow[],
): { readonly record: TurnRecord; readonly orphans: number } {
  let current = record;
  let orphans = 0;
  for (const row of rows) {
    const next = applyDeltaRow(current, row);
    current = next.record;
    if (next.orphan) orphans += 1;
  }
  return { record: current, orphans };
}

function applied(record: TurnRecord): DeltaApplied {
  return { record, orphan: false };
}

function orphaned(record: TurnRecord): DeltaApplied {
  return { record, orphan: true };
}

function applyHook(record: TurnRecord, stepIndex: number | null, run: HookRun): DeltaApplied {
  if (stepIndex === null) {
    return applied({ ...record, turnHooks: upsertBy(record.turnHooks, hookKeyOf, run) });
  }
  const step = record.steps.find((item) => item.stepIndex === stepIndex);
  if (step === undefined) return orphaned(record);
  const toolCallId = run.toolCallId;
  if (toolCallId === null) {
    return applied(withStep(record, { ...step, hooks: upsertBy(step.hooks, hookKeyOf, run) }));
  }
  const call = step.calls.find((item) => item.toolCallId === toolCallId);
  if (call === undefined) return orphaned(record);
  const nextCall: CallRecord = { ...call, hooks: upsertBy(call.hooks, hookKeyOf, run) };
  return applied(withStep(record, { ...step, calls: upsertBy(step.calls, callKeyOf, nextCall) }));
}

function applyCall(record: TurnRecord, stepIndex: number, call: CallRecord): DeltaApplied {
  const step = record.steps.find((item) => item.stepIndex === stepIndex);
  if (step === undefined) return orphaned(record);
  return applied(withStep(record, { ...step, calls: upsertBy(step.calls, callKeyOf, call) }));
}

/** 단계를 넣거나 같은 번호의 것을 바꾼다. 결과는 단계 번호 순이다 */
function upsertStep(steps: readonly StepRecord[], step: StepRecord): StepRecord[] {
  const rest = steps.filter((item) => item.stepIndex !== step.stepIndex);
  return [...rest, step].toSorted((a, b) => a.stepIndex - b.stepIndex);
}

/** 이미 있는 단계를 바꾼다. 호출 쪽이 단계가 있음을 확인한 뒤에 쓴다 */
function withStep(record: TurnRecord, step: StepRecord): TurnRecord {
  return {
    ...record,
    steps: record.steps.map((item) => (item.stepIndex === step.stepIndex ? step : item)),
  };
}

function upsertBy<T>(items: readonly T[], keyOf: (item: T) => string, next: T): T[] {
  const key = keyOf(next);
  if (!items.some((item) => keyOf(item) === key)) return [...items, next];
  return items.map((item) => (keyOf(item) === key ? next : item));
}

function hookKeyOf(run: HookRun): string {
  return JSON.stringify([run.seq, run.hook, run.registrationId, run.toolCallId, run.atMs]);
}

function callKeyOf(call: CallRecord): string {
  return call.toolCallId;
}

function childKeyOf(child: TurnChild): string {
  return child.childThreadId;
}

function frameKeyOf(frame: FrameMark): string {
  return frame.leaseId ?? JSON.stringify(["depth", frame.depth, frame.enteredAtMs]);
}
