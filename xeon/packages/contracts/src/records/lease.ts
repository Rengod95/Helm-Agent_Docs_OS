import type { Result } from "../base/index.ts";
import type { SqlTx } from "./sql.ts";

/** "session:<threadId>" | "scheduler" | "service" */
export type LeaseResource = string;
export const LEASE_RESOURCE_PATTERN: string =
  "^(session:thr_[0-7][0-9A-HJKMNP-TV-Z]{25}|scheduler|service)$";

export type LeaseKind = "cli" | "app" | "service";

/** 임대를 쥐려는 쪽. 엔진 인스턴스마다 하나 */
export interface LeaseHolder {
  /** 엔진 인스턴스 id. 시작 때 IdFactory로 만든다 */
  readonly holderId: string;
  readonly kind: LeaseKind;
  readonly pid: number;
  /** 프로세스 시작 시각 지문(epoch ms). L0.os가 준다 */
  readonly startedAt: number;
  /** 기계 식별자. 같은 기계 판정용 */
  readonly host: string;
}

/** 쓰기 소유 증표. 커밋 트랜잭션 안에서 sys_leases 행의 epoch와 대조한다(펜싱, review.decisions-2 U-09) */
export interface LeaseToken {
  readonly resource: LeaseResource;
  readonly holderId: string;
  readonly epoch: number;
}

/** sys_leases 행을 옮긴 표시 정보. 판정에 쓰지 않는다 */
export interface LeaseOwnerInfo {
  readonly holderId: string;
  readonly kind: LeaseKind;
  readonly pid: number;
  readonly startedAt: number;
  readonly host: string;
  readonly epoch: number;
  readonly heartbeatAt: number;
  readonly expiresAt: number;
}

/** 잠금 실패 정보. 정책은 L0.process.spec의 LockFallbackPolicy가 정한다 */
export interface LockBusy {
  readonly kind: "lock_busy";
  readonly resource: LeaseResource;
  readonly reason: "os_lock_held" | "lease_active";
  /** 행이 없거나 경합 중 사라졌으면 null */
  readonly owner: LeaseOwnerInfo | null;
}

/** sys_leases 행을 읽을 수 없다. where는 `sys_leases.<열>` 같은 위치 이름이다 */
export interface LeaseRowInvalid {
  readonly kind: "row_invalid";
  readonly where: string;
}

export type LeaseError =
  | LockBusy
  | { readonly kind: "lease_lost"; readonly resource: LeaseResource }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "lock_io"; readonly code: string }
  /** sys_leases 행이 스키마와 다르다(손상, 수동 편집) */
  | LeaseRowInvalid;

export interface LeaseService {
  acquire(resource: LeaseResource, holder: LeaseHolder): Result<LeaseToken, LeaseError>;
  /** 하트비트 한 번. 소유가 바뀌었으면 lease_lost */
  renew(token: LeaseToken): Result<void, LeaseError>;
  /** 행을 반납 상태로 두고 OS 잠금을 푼다. 이미 잃었으면 ok(아무 일 없음) */
  release(token: LeaseToken): Result<void, LeaseError>;
  /** 쓰기 트랜잭션 안에서 행을 새로 읽어 대조한다(TX-10). 캐시를 쓰지 않는다 */
  holds(tx: SqlTx, token: LeaseToken): Result<boolean, LeaseRowInvalid>;
  /** 읽기 연결로 현재 소유 정보를 본다. 표시용 */
  inspect(
    resource: LeaseResource,
  ): Result<LeaseOwnerInfo | null, { readonly kind: "busy" } | LeaseRowInvalid>;
  /** heartbeatMs마다 renew. 실패가 lease_lost면 onLost를 한 번 부르고 멈춘다 */
  keepAlive(token: LeaseToken, onLost: (resource: LeaseResource) => void): Disposable;
}
