import type { StoreService } from "@xeon/contracts/records";

/** 상태 표가 쓰는 `xeon.store`의 부분. `scoped("cap.mcp")`, 마이그레이션, blob 저장만 쓴다 */
export type McpStorePort = Pick<StoreService, "scoped" | "putBlob" | "migrations">;
