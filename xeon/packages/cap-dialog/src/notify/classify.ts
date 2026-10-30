import { assertNever, parse } from "@xeon/contracts";
import type { Notice, NoticeKind } from "@xeon/contracts/capabilities";
import { TurnCompletedPayloadSchema } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope } from "@xeon/contracts/records";
import {
  AgentSettledEventPayloadSchema,
  ApprovalRequestedPayloadSchema,
  DialogNotifiedSchema,
  RunFinishedPayloadSchema,
  WorkGoalSettledSchema,
} from "@xeon/contracts/records";
import { clip } from "../util.ts";

// L2.dialog.spec §4.7.1 분류 표. 내구 이벤트 하나에서 알림을 계산하는 순수 함수다.
// 파생 알림은 새 이벤트를 쓰지 않는다. 모르는 종류와 해석할 수 없는 payload는 null이다.

const TITLE_MAX = 120;
const BODY_MAX = 1000;

function notice(
  event: DurableEventEnvelope,
  kind: NoticeKind,
  title: string,
  body: string | null,
): Notice {
  return {
    kind,
    title: clip(title, TITLE_MAX),
    body: body === null ? null : clip(body, BODY_MAX),
    seq: event.seq,
    sourceType: event.kind,
  };
}

/** switch는 EventKind 전부를 나열해야 해서(switch-exhaustiveness-check) 조건문으로 고른다. 나머지 종류는 알림이 아니다 */
export function classifyNotice(event: DurableEventEnvelope): Notice | null {
  if (event.kind === "turn.completed") return fromTurnCompleted(event);
  if (event.kind === "work.goal_settled") return fromGoalSettled(event);
  if (event.kind === "approval.requested") return fromApprovalRequested(event);
  if (event.kind === "agent.settled") return fromAgentSettled(event);
  if (event.kind === "schedule.run_finished") return fromRunFinished(event);
  if (event.kind === "dialog.notified") return fromDialogNotified(event);
  return null;
}

function fromTurnCompleted(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(TurnCompletedPayloadSchema, event.payload);
  if (!parsed.ok) return null;
  const { status, error } = parsed.value;
  switch (status) {
    case "completed":
      return notice(event, "completed", "작업이 끝났다", null);
    case "failed":
      return notice(event, "error", "턴이 실패했다", error);
    // 사용자가 직접 끊은 턴은 알리지 않는다
    case "interrupted":
      return null;
    default:
      return assertNever(status, "fromTurnCompleted");
  }
}

function fromGoalSettled(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(WorkGoalSettledSchema, event.payload);
  if (!parsed.ok) return null;
  const { status, judgments } = parsed.value;
  switch (status) {
    case "met":
      return notice(event, "completed", "목표를 달성했다", `판정 ${judgments}회`);
    case "limit_reached":
      return notice(event, "completed", "목표 판정 한도에 도달했다", `판정 ${judgments}회`);
    case "judge_failed":
      return notice(event, "error", "목표 판정에 실패했다", null);
    case "active":
    case "cleared":
      return null;
    default:
      return assertNever(status, "fromGoalSettled");
  }
}

function fromApprovalRequested(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(ApprovalRequestedPayloadSchema, event.payload);
  if (!parsed.ok) return null;
  const body = parsed.value.body;
  switch (body.kind) {
    case "tool":
      return notice(event, "approval_waiting", `승인이 필요하다: ${body.tool.toolName}`, null);
    case "plan":
      return notice(event, "approval_waiting", "승인이 필요하다: plan", null);
    case "question":
      return notice(event, "question_waiting", "질문에 답이 필요하다", null);
    // 검토 승인은 §4.7.1 표에 없다 [미결]
    case "review":
      return null;
    default:
      return assertNever(body, "fromApprovalRequested");
  }
}

/**
 * 자식 종료 이벤트. 이벤트에는 전경·백그라운드 구분이 없어 agent.settled를 모두 분류한다
 * [결정: 오케스트레이터 기본값]. 사용자가 끊은 aborted는 알리지 않는다.
 */
function fromAgentSettled(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(AgentSettledEventPayloadSchema, event.payload);
  if (!parsed.ok) return null;
  const { status, error } = parsed.value;
  switch (status) {
    case "completed":
      return notice(event, "background_completed", "백그라운드 작업이 끝났다", null);
    case "error":
      return notice(event, "error", "백그라운드 작업이 실패했다", error);
    case "aborted":
      return null;
    default:
      return assertNever(status, "fromAgentSettled");
  }
}

/** 예약 실행 종료. aborted와 awaiting_approval은 알리지 않는다 [결정: 오케스트레이터 기본값] */
function fromRunFinished(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(RunFinishedPayloadSchema, event.payload);
  if (!parsed.ok) return null;
  const { outcome } = parsed.value;
  switch (outcome) {
    case "completed":
      return notice(event, "background_completed", "예약 작업이 끝났다", null);
    case "failed":
      return notice(event, "error", "예약 작업이 실패했다", null);
    case "aborted":
    case "awaiting_approval":
      return null;
    default:
      return assertNever(outcome, "fromRunFinished");
  }
}

/** dialog.notify.emit이 남긴 알림. 제목이 비면 Notice 스키마(minLength 1)를 어겨 알림이 되지 못한다 */
function fromDialogNotified(event: DurableEventEnvelope): Notice | null {
  const parsed = parse(DialogNotifiedSchema, event.payload);
  if (!parsed.ok || parsed.value.notice.title.length === 0) return null;
  const { kind, title, body } = parsed.value.notice;
  return notice(event, kind, title, body);
}
