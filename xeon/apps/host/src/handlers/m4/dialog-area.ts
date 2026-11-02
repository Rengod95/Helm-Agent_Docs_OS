import { assertNever, type Result } from "@fresnel/contracts";
import type { ReadFailure } from "@fresnel/contracts/records";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import {
  wireError,
  type GoalStatusResult,
  type ReviewGetResult,
  type ScheduleRunsParams,
  type ScheduleRunsResult,
  type ScheduleUpdateParams,
  type ScheduleUpdateResult,
  type WireError,
  type WireHandlers,
  type WorkTasksListResult,
} from "@fresnel/contracts/wire";

// 대화 영역 wire(`review.get` W-02, `goal.status` W-05, `work.tasks.list` W-06, `schedule.update`·`schedule.runs` W-07).
// 처리기는 포트가 돌려준 오류 값을 와이어 오류로 옮길 뿐이다. 포트 구현은 `assembly/m4/dialog-area-port.ts`다.
// 전용 와이어 오류 kind가 아직 없어서(F 갭) 모르는 id와 한도는 `jsonrpc.invalidParams`의 issue로 알린다.

/** 포트가 읽지 못한 이유. 처리기가 와이어 오류로 옮긴다 */
export type DialogAreaFailure =
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  /** 모르는 id: 리뷰, 예약 */
  | { readonly kind: "unknown"; readonly path: "reviewId" | "scheduleId"; readonly id: string }
  /** 켜진 예약 수 상한에 닿아 다시 켤 수 없다 */
  | { readonly kind: "limit_reached"; readonly max: number }
  /** 예약 저장소나 리뷰 본문을 읽거나 쓰지 못했다 */
  | { readonly kind: "store_failed"; readonly message: string }
  /** 세션 저장소 읽기가 실패했다(busy, io, 손상 행). 와이어 `store.*` 오류로 옮긴다 */
  | { readonly kind: "read_failed"; readonly error: ReadFailure }
  /** 기능이 입력을 거절했다(`code`는 기능 오류 코드) */
  | { readonly kind: "rejected"; readonly code: string; readonly message: string }
  /** 리뷰 본문을 읽는 기능이 올라와 있지 않다 */
  | { readonly kind: "unavailable" };

export type DialogAreaOutcome<T> = Result<T, DialogAreaFailure>;

/** 처리기가 쓰는 포트 */
export interface DialogAreaPort {
  /** 리뷰의 hunk 본문(W-02) */
  reviewGet(reviewId: string, signal: AbortSignal): Promise<DialogAreaOutcome<ReviewGetResult>>;
  /** 대화의 목표 상태(W-05). 목표가 없거나 기능이 꺼져 있으면 `goal: null` */
  goalStatus(threadId: ThreadId, signal: AbortSignal): Promise<DialogAreaOutcome<GoalStatusResult>>;
  /** 대화의 작업 목록(W-06). 기능이 꺼져 있으면 빈 목록 */
  tasksList(
    threadId: ThreadId,
    signal: AbortSignal,
  ): Promise<DialogAreaOutcome<WorkTasksListResult>>;
  /** 예약을 다시 켜고 고친다(W-07) */
  scheduleUpdate(params: ScheduleUpdateParams): Promise<DialogAreaOutcome<ScheduleUpdateResult>>;
  /** 예약의 실행 기록(W-07), 새 것부터 */
  scheduleRuns(params: ScheduleRunsParams): Promise<DialogAreaOutcome<ScheduleRunsResult>>;
}

export type DialogAreaMethods =
  | "review.get"
  | "goal.status"
  | "work.tasks.list"
  | "schedule.update"
  | "schedule.runs";

const MESSAGE_MAX = 200;

function invalid(path: string, message: string): WireError {
  return wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
}

/** 세션 저장소 읽기 실패 → `store.*`. `store-error.ts`는 이 묶음이 import하면 순환이 되므로 읽기 실패 세 가지만 여기서 옮긴다(`wireErrorOfStore`와 같은 값) */
function wireErrorOfRead(error: ReadFailure, method: DialogAreaMethods): WireError {
  switch (error.kind) {
    case "busy":
      return wireError("store.busy", { message: `${method}: store busy` });
    case "io":
      return wireError("store.io", {
        message: `${method}: store io`,
        details: { code: error.code.slice(0, 64) },
      });
    case "row_invalid":
      return wireError("store.corrupt", {
        message: `${method}: stored row is invalid`,
        details: { where: error.where.slice(0, 128) },
      });
    default:
      return assertNever(error, "ReadFailure");
  }
}

function wireErrorOf(failure: DialogAreaFailure, method: DialogAreaMethods): WireError {
  switch (failure.kind) {
    case "thread_not_found":
      return wireError("thread.notFound", { details: { threadId: failure.threadId } });
    case "unknown":
      return invalid(
        failure.path,
        `unknown ${failure.path === "reviewId" ? "review" : "schedule"}`,
      );
    case "limit_reached":
      return invalid("enabled", `active schedule limit reached (max ${String(failure.max)})`);
    case "store_failed":
      return wireError("store.io", {
        message: `${method}: ${failure.message.slice(0, MESSAGE_MAX)}`,
        details: {
          code: method === "review.get" ? "review_store_failed" : "schedule_store_failed",
        },
      });
    case "read_failed":
      return wireErrorOfRead(failure.error, method);
    case "rejected":
      // 기능이 입력을 거절한 것이 아니라(두 입력은 모두 wire 스키마가 검사한다) 읽기가 실패한 것이라 internal에 기능 오류 코드를 싣는다
      return wireError("internal", {
        message: `${method}: ${failure.code}: ${failure.message.slice(0, MESSAGE_MAX)}`,
      });
    case "unavailable":
      return wireError("jsonrpc.methodNotFound", { details: { method } });
    default:
      return assertNever(failure, "DialogAreaFailure");
  }
}

async function unwrapped<T>(
  outcome: Promise<DialogAreaOutcome<T>>,
  method: DialogAreaMethods,
): Promise<T> {
  const settled = await outcome;
  if (!settled.ok) throw wireErrorOf(settled.error, method);
  return settled.value;
}

/** 와이어의 threadId는 문자열이다. thr_ 꼴이 아니면 그런 thread는 없다 */
function threadIdOf(raw: string): ThreadId {
  if (isId("thr", raw)) return raw;
  throw wireError("thread.notFound", { details: { threadId: raw.slice(0, 64) } });
}

export function createDialogAreaHandlers(
  port: DialogAreaPort,
): Pick<WireHandlers, DialogAreaMethods> {
  return {
    "review.get": (params, context) =>
      unwrapped(port.reviewGet(params.reviewId, context.signal), "review.get"),
    "goal.status": (params, context) =>
      unwrapped(port.goalStatus(threadIdOf(params.threadId), context.signal), "goal.status"),
    "work.tasks.list": (params, context) =>
      unwrapped(port.tasksList(threadIdOf(params.threadId), context.signal), "work.tasks.list"),
    "schedule.update": (params) => unwrapped(port.scheduleUpdate(params), "schedule.update"),
    "schedule.runs": (params) => unwrapped(port.scheduleRuns(params), "schedule.runs"),
  };
}
