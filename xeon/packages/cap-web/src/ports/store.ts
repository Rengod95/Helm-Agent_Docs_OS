import type { StoreService } from "@fresnel/contracts/records";

/** 캐시와 사용량 표가 쓰는 `fresnel.store`의 부분. `scoped("cap.web")`, 마이그레이션, blob 저장·고정만 쓴다 */
export type WebStorePort = Pick<
  StoreService,
  "scoped" | "putBlob" | "readBlob" | "pinBlob" | "unpinBlob" | "migrations"
>;
