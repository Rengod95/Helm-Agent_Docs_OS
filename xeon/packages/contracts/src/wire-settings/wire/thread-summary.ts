import { attempt, err, ok, type Result } from "../../base/index.ts";
import type { ThreadSummaryRow } from "../../records/index.ts";
import type { ThreadSummary } from "./methods.ts";

// F.wire-settings.spec §3.3.1 ThreadSummary. 호스트가 투영 행(ThreadSummaryRow, epoch ms)을 wire 모양(IsoTime)으로 옮기는 순수 함수다.

export interface ThreadSummaryError {
  readonly kind: "invalid_time";
  /** 바꾸지 못한 필드. 예: "createdAt", "resumable.runningSince" */
  readonly field: string;
}

function isoOf(ms: number, field: string): Result<string, ThreadSummaryError> {
  const converted = attempt(() => new Date(ms).toISOString());
  return converted.ok ? ok(converted.value) : err({ kind: "invalid_time", field });
}

/** 순수 함수. ms가 Date 범위 밖이면 오류 값이다. 던지지 않는다 */
export function threadSummaryOf(row: ThreadSummaryRow): Result<ThreadSummary, ThreadSummaryError> {
  const createdAt = isoOf(row.createdAt, "createdAt");
  if (!createdAt.ok) return createdAt;
  const updatedAt = isoOf(row.updatedAt, "updatedAt");
  if (!updatedAt.ok) return updatedAt;
  let resumable: ThreadSummary["resumable"] = null;
  if (row.marker !== null) {
    const runningSince = isoOf(row.marker.runningSince, "resumable.runningSince");
    if (!runningSince.ok) return runningSince;
    resumable = {
      turnId: row.marker.turnId,
      runningSince: runningSince.value,
      resumeAttempts: row.marker.resumeAttempts,
    };
  }
  return ok({
    threadId: row.threadId,
    title: row.title,
    status: row.status,
    workspace: row.workspace,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    headSeq: row.headSeq,
    forkedFrom:
      row.forkedFrom === null
        ? null
        : { threadId: row.forkedFrom.threadId, eventId: row.forkedFrom.eventId },
    resumable,
    queuedInputs: row.queuedInputs,
    pendingApprovals: row.pendingApprovals,
  });
}
