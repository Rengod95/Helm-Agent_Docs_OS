import { Bug, parse } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  STEP_CHECKPOINT_SCHEMA_VERSION,
  StepCheckpointSchema,
  type DraftInput,
  type SqlTx,
  type StepCheckpoint,
  type StepCheckpointInput,
} from "@xeon/contracts/records";
import { parseJson } from "./events.ts";
import { columnInt, columnString } from "./rows.ts";

/**
 * 승인 대기 커밋(A1)은 step.completed 없이 체크포인트를 쓴다(L1.persistence.spec §4.2, FR-P4).
 * 조건: pendingToolCalls에 waiting: "approval"이 있다. next는 "tools"(L1.persistence.spec §4.2) 또는 "await_input"이다:
 * L1.tools.spec §4.7 2번과 L1.loop.spec §4.5 재진입 표가 승인 대기 체크포인트의 next를 "await_input"으로 정해
 * 루프의 대기 체크포인트가 그 값이다 [미결: 두 문서의 값 정렬]
 */
export function isApprovalWait(input: StepCheckpointInput): boolean {
  return (
    (input.next === "tools" || input.next === "await_input") &&
    input.pendingToolCalls.some((call) => call.waiting === "approval")
  );
}

/** 저장소가 채우는 네 필드(checkpointId, schemaVersion, threadId, leafEventId)를 더해 StepCheckpoint를 만든다 */
export function completeCheckpoint(
  input: StepCheckpointInput,
  fill: { readonly ids: IdFactory; readonly threadId: ThreadId; readonly leafEventId: EventId },
): StepCheckpoint {
  return {
    ...input,
    checkpointId: fill.ids.next("ckp"),
    schemaVersion: STEP_CHECKPOINT_SCHEMA_VERSION,
    threadId: fill.threadId,
    leafEventId: fill.leafEventId,
  };
}

/** checkpoint.step 이벤트 초안 입력. 체크포인트 내용은 루프가 만들고 envelope는 저장소가 만든다 */
export function checkpointDraftInput(
  record: StepCheckpoint,
  eventId: EventId,
  causationId: EventId,
): DraftInput {
  return {
    id: eventId,
    kind: "checkpoint.step",
    threadId: record.threadId,
    turnId: record.turnId,
    stepId: record.stepId,
    causationId,
    correlationId: record.turnId,
    payload: record,
  };
}

/**
 * thread의 마지막 체크포인트. schemaVersion이 현재와 다르면 버린다(이벤트에서 복원해야 한다, eng.events.design §5.1 7번).
 * 저장된 record가 스키마와 다르면 코드 결함이다
 */
export function readCheckpoint(tx: SqlTx, threadId: string): StepCheckpoint | null {
  const row = tx.get("SELECT schema_version, record FROM step_checkpoints WHERE thread_id = ?", [
    threadId,
  ]);
  if (row === undefined) return null;
  if (columnInt(row, "schema_version") !== STEP_CHECKPOINT_SCHEMA_VERSION) return null;
  const parsed = parse(StepCheckpointSchema, parseJson(columnString(row, "record")));
  if (!parsed.ok) {
    throw new Bug("store.row_invalid: step_checkpoints.record", { cause: parsed.error });
  }
  return parsed.value;
}
