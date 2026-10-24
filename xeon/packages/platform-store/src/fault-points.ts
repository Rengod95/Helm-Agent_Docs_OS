/** 이 패키지 전용 장애 주입 지점(F FaultPoint에 넣지 않는다, L0.store.plan §5). 운영 구현은 아무것도 하지 않는다 */
export type StoreFaultPoint =
  | "blob_after_tmp_write"
  | "blob_after_fsync"
  | "blob_after_rename"
  | "blob_before_row"
  | "lease_after_os_lock"
  | "lease_before_commit"
  | "migration_after_step";

export const STORE_FAULT_POINTS: readonly StoreFaultPoint[] = [
  "blob_after_tmp_write",
  "blob_after_fsync",
  "blob_after_rename",
  "blob_before_row",
  "lease_after_os_lock",
  "lease_before_commit",
  "migration_after_step",
];

export interface StoreFaultInjector {
  hit(point: StoreFaultPoint): void;
}

export const NO_STORE_FAULTS: StoreFaultInjector = {
  hit: (): void => {},
};
