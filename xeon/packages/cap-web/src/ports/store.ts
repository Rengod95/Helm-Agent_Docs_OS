import type { StoreService } from "@xeon/contracts/records";

/** 캐시와 사용량 표가 쓰는 `xeon.store`의 부분. `scoped("cap.web")`, 마이그레이션, blob 저장만 쓴다 */
export type WebStorePort = Pick<StoreService, "scoped" | "putBlob" | "readBlob" | "migrations">;
