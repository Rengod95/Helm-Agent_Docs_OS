import type { MigrationSet } from "@xeon/contracts/records";
import { EVENTS_DDL, REQUESTS_DDL, STATE_DDL } from "./ddl.ts";

/** 마이그레이션 소유자. L0.store의 sys_prefixes에 등록된 코어 소유자 이름이다 */
export const SESSION_MIGRATION_OWNER = "core.persistence";

/**
 * 비투영 테이블의 마이그레이션 목록(L1.persistence.plan PS-1). L0 실행기가 순서와 체크섬을 관리한다.
 * 투영 테이블은 여기에 두지 않는다. 투영기 core의 ddl이 만들고 projector_state 버전으로 다시 만든다.
 */
export const SESSION_MIGRATION_SET: MigrationSet = {
  owner: SESSION_MIGRATION_OWNER,
  version: 1,
  steps: [{ version: 1, sql: [...EVENTS_DDL, ...REQUESTS_DDL, ...STATE_DDL] }],
};
