import { assertNever } from "@xeon/contracts";
import { CapabilityError, type CapabilityId } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { StoreError } from "@xeon/contracts/records";
import type { PlanFailure } from "./plans/failure.ts";
import type { OpFailure } from "./tasks/failure.ts";

// 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6). 내부 규칙은 값(OpFailure, StoreError)으로
// 다루고 이 파일이 경계에서 한 번 바꾼다.

function make(
  capability: CapabilityId,
  method: string,
  code: string,
  message: string,
  retryable: boolean,
  detail?: JsonValue,
): CapabilityError {
  return new CapabilityError({
    capability,
    method,
    code,
    message,
    retryable,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** 작업 규칙 거부. `write`는 실패한 연산 번호를 detail.opIndex에 싣는다(spec §4.1.1, §5.3) */
export function taskRejection(
  capability: CapabilityId,
  method: string,
  value: OpFailure,
  includeOpIndex: boolean,
): CapabilityError {
  const { failure, opIndex } = value;
  const withIndex = (detail: Record<string, JsonValue>): JsonValue =>
    includeOpIndex ? { ...detail, opIndex } : detail;
  switch (failure.kind) {
    case "invalid_input":
      return make(capability, method, "invalid_input", failure.message, false, withIndex({}));
    case "not_found":
      return make(
        capability,
        method,
        "not_found",
        `Task ${failure.id} does not exist.`,
        false,
        withIndex({ id: failure.id }),
      );
    case "task_cycle":
      return make(
        capability,
        method,
        "task_cycle",
        `Adding this blocker creates a cycle: ${failure.path.join(" -> ")}.`,
        false,
        withIndex({ path: [...failure.path] }),
      );
    case "task_blocked":
      return make(
        capability,
        method,
        "task_blocked",
        `Blocked by unfinished tasks: ${failure.blockers.join(", ")}. Pass force to start anyway.`,
        false,
        withIndex({ blockers: [...failure.blockers] }),
      );
    case "task_transition_invalid":
      return make(
        capability,
        method,
        "task_transition_invalid",
        `A ${failure.from} task cannot become ${failure.to}.`,
        false,
        withIndex({ from: failure.from, to: failure.to }),
      );
    case "task_ref_unknown":
      return make(
        capability,
        method,
        "task_ref_unknown",
        `Reference ${failure.ref} was not created earlier in this call.`,
        false,
        withIndex({ ref: failure.ref }),
      );
    case "task_limit":
      return make(
        capability,
        method,
        "task_limit",
        "The thread reached its task limit.",
        false,
        withIndex({}),
      );
    default:
      return assertNever(failure, "taskRejection");
  }
}

/** 계획 규칙 거부와 권한 모드·승인 포트 부재 */
export function planRejection(
  capability: CapabilityId,
  method: string,
  failure: PlanFailure,
): CapabilityError {
  switch (failure.kind) {
    case "invalid_input":
      return make(capability, method, "invalid_input", failure.message, false);
    case "not_found":
      return make(capability, method, "not_found", `${failure.id} does not exist.`, false, {
        id: failure.id,
      });
    case "plan_pending":
      return make(
        capability,
        method,
        "plan_pending",
        "An earlier version of this plan is still waiting for approval.",
        false,
      );
    case "plan_closed":
      return make(
        capability,
        method,
        "plan_closed",
        `This plan version is already ${failure.status}.`,
        false,
        { status: failure.status },
      );
    case "plan_not_approved":
      return make(
        capability,
        method,
        "plan_not_approved",
        "Plan mode can only be left after the plan is approved. Submit it with submit_plan.",
        false,
      );
    case "plan_mode_inactive":
      return make(capability, method, "plan_mode_inactive", "Plan mode is not active.", false);
    case "unavailable":
      return make(capability, method, "unavailable", failure.message, false);
    case "mode_forbidden":
      return make(
        capability,
        method,
        "denied",
        `The permission mode ${failure.mode} cannot be set here.`,
        false,
        { mode: failure.mode },
      );
    default:
      return assertNever(failure, "planRejection");
  }
}

/** 저장소 실패. 예상 가능한 환경 문제이므로 호출자가 다룰 수 있는 코드로 바꾼다 */
export function storeRejection(
  capability: CapabilityId,
  method: string,
  error: StoreError,
): CapabilityError {
  switch (error.kind) {
    case "busy":
      return make(capability, method, "unavailable", "The session store is busy.", true);
    case "disk_full":
      return make(capability, method, "unavailable", "The disk is full.", false);
    case "io":
      return make(capability, method, "unavailable", `Store I/O failed (${error.code}).`, false);
    case "ownership_lost":
      return make(
        capability,
        method,
        "unavailable",
        "This process no longer owns the thread.",
        false,
      );
    case "read_only":
      return make(
        capability,
        method,
        "unavailable",
        `The thread is read-only (${error.reason}).`,
        false,
      );
    case "thread_not_found":
      return make(
        capability,
        method,
        "not_found",
        `Thread ${error.threadId} does not exist.`,
        false,
      );
    case "row_invalid":
      return make(
        capability,
        method,
        "internal",
        `A stored row is damaged (${error.where}).`,
        false,
      );
    default:
      return assertNever(error, "storeRejection");
  }
}

export function invalidInput(
  capability: CapabilityId,
  method: string,
  message: string,
): CapabilityError {
  return make(capability, method, "invalid_input", message, false);
}

export function internalError(
  capability: CapabilityId,
  method: string,
  message: string,
): CapabilityError {
  return make(capability, method, "internal", message, false);
}

export function abortedError(capability: CapabilityId, method: string): CapabilityError {
  return make(capability, method, "aborted", "The operation was aborted.", false);
}
