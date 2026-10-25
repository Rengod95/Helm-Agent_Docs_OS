import { assertNever, Bug } from "@xeon/contracts";
import type { LeaseError, LifecycleError, StoreError } from "@xeon/contracts/records";
import { wireError, type WireError } from "@xeon/contracts/wire";
import { threadLocked } from "./handlers/owner.ts";

// 저장소 오류는 예상 가능한 실패다(eng.typescript.guide TY-24). 결함(Bug)으로 던지지 않고 와이어 오류 kind로 옮긴다
// (F.wire-settings.spec §3.5.2 store.*).

const CODE_MAX = 64;
/** store.corrupt의 details.where 상한(F wire §3.5.2) */
const WHERE_MAX = 128;

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
      // 저장된 행이 모양과 다르다(손상, 수동 편집). 매체 오류(store.io)와 복구 안내가 달라서 store.corrupt로 알린다(F.records.spec §3.7 7항)
      return wireError("store.corrupt", {
        message: `${where}: stored row is invalid`,
        details: { where: error.where.slice(0, WHERE_MAX) },
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
      return wireError("store.corrupt", {
        message: `${where}: lease row is invalid`,
        details: { where: error.where.slice(0, WHERE_MAX) },
      });
    case "lease_lost":
      return threadLocked(null);
    default:
      return assertNever(error, "LeaseError");
  }
}

/**
 * 저장소의 `key_reused`를 호출 결함으로 판정하는 자리는 여기 하나다(수명 주기, 생성, 설정 쓰기가 같이 쓴다).
 * 호스트는 요청 키를 호출마다 새로 만든다. 같은 키가 다른 내용으로 다시 오는 것은 호스트가 키를 잘못 다뤘다는 불변 조건 위반이다
 */
export function keyReusedBug(error: { readonly kind: "key_reused" }, where: string): Bug {
  return new Bug(`${where}: the host builds a fresh request key per call`, { cause: error });
}

/**
 * 수명 주기 호출(fork, revert, delete)의 오류. 예상 가능한 실패는 와이어 오류로 옮긴다(F wire §3.5.2).
 * `key_reused`는 호출마다 새 요청 키를 만드는 호스트에서는 나올 수 없다(불변 조건 위반이라 Bug)
 */
export function wireErrorOfLifecycle(error: LifecycleError, where: string): WireError | Bug {
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
      return threadLocked(null);
    case "thread_closed":
      // 종결된 thread에는 쓰기와 수명 주기 호출을 할 수 없다. 읽기와 삭제는 허용한다(F wire §3.5.2 3007)
      return wireError("thread.closed", { details: { threadId: error.threadId } });
    case "turn_running":
      return wireError("turn.busy", { details: { turnId: error.turnId } });
    case "has_forks":
      return wireError("thread.hasForks", { details: { forks: [...error.forks] } });
    case "invalid_target":
      return wireError("thread.invalidTarget", { details: { reason: error.reason } });
    case "cancelled_by_extension":
      return wireError("thread.cancelledByExtension", {
        details: { point: error.point, reason: error.reason },
      });
    case "key_reused":
      return keyReusedBug(error, where);
    default:
      return assertNever(error, "LifecycleError");
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
    case "key_reused":
      return keyReusedBug(error, where);
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
