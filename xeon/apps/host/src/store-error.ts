import { assertNever, Bug } from "@xeon/contracts";
import type { LeaseError, LifecycleError, StoreError } from "@xeon/contracts/records";
import { wireError, type WireError } from "@xeon/contracts/wire";
import { threadLocked } from "./handlers/owner.ts";

// 저장소 오류는 예상 가능한 실패다(eng.typescript.guide TY-24). 결함(Bug)으로 던지지 않고 와이어 오류 kind로 옮긴다
// (F.wire-settings.spec §3.5.2 store.*).

const CODE_MAX = 64;

/** StoreError → 와이어 오류. where는 개발자용 메시지 앞머리다 */
export function wireErrorOfStore(error: StoreError, where: string): WireError {
  switch (error.kind) {
    case "busy":
      return wireError("store.busy", { message: `${where}: store busy` });
    case "disk_full":
      return wireError("store.diskFull", { message: `${where}: store disk full` });
    case "io":
      return wireError("store.io", {
        message: `${where}: store io`,
        details: { code: error.code.slice(0, CODE_MAX) },
      });
    case "row_invalid":
      // 저장된 행이 모양과 다르다(손상, 수동 편집). 저장 매체 문제로 보이므로 store.io로 옮긴다(위치 이름은 메시지에만 싣는다)
      return wireError("store.io", {
        message: `${where}: stored row is invalid (${error.where.slice(0, CODE_MAX)})`,
        details: { code: "row_invalid" },
      });
    case "read_only":
      return wireError("store.readOnly", {
        message: `${where}: store read only`,
        details: { reason: error.reason },
      });
    case "ownership_lost":
      return threadLocked(null);
    case "thread_not_found":
      return wireError("thread.notFound", { details: { threadId: error.threadId } });
    default:
      return assertNever(error, "StoreError");
  }
}

/** lock_busy는 호출자가 소유자 정보와 함께 먼저 다룬다. 여기서는 그 밖의 잠금 오류를 옮긴다 */
export function wireErrorOfLease(
  error: Exclude<LeaseError, { kind: "lock_busy" }>,
  where: string,
): WireError {
  switch (error.kind) {
    case "busy":
      return wireError("store.busy", { message: `${where}: lease busy` });
    case "disk_full":
      return wireError("store.diskFull", { message: `${where}: lease disk full` });
    case "lock_io":
      return wireError("store.io", {
        message: `${where}: lease io`,
        details: { code: error.code.slice(0, CODE_MAX) },
      });
    case "row_invalid":
      return wireError("store.io", {
        message: `${where}: lease row is invalid (${error.where.slice(0, CODE_MAX)})`,
        details: { code: "row_invalid" },
      });
    case "lease_lost":
      return threadLocked(null);
    default:
      return assertNever(error, "LeaseError");
  }
}

/** thread 생성의 오류. 저장소 실패는 store.* kind이고, 생성에서 나올 수 없는 변형은 호출 결함이다 */
export function wireErrorOfCreate(error: LifecycleError, where: string): WireError | Bug {
  switch (error.kind) {
    case "busy":
    case "disk_full":
    case "io":
    case "read_only":
    case "row_invalid":
    case "ownership_lost":
    case "thread_not_found":
      return wireErrorOfStore(error, where);
    case "not_owner":
    case "thread_closed":
    case "turn_running":
    case "has_forks":
    case "invalid_target":
    case "cancelled_by_extension":
      return new Bug(`${where}: lifecycle error ${error.kind} cannot come from create`, {
        cause: error,
      });
    default:
      return assertNever(error, "LifecycleError");
  }
}
