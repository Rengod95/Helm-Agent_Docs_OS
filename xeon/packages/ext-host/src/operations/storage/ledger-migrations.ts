import type { MigrationSet } from "@fresnel/contracts/records";

// 소유자 `xh`(접두 `xh_`)의 마이그레이션. 저장소는 마이그레이션 밖의 DDL을 거부하므로(L0.store.spec §4.5) 소유 장부는 여기서 만든다.
// 적용된 단계를 바꾸지 않는다(체크섬). 열을 더하면 단계를 더한다.

const LEDGER_OWNER = "xh";
export const LEDGER_TABLE = "xh_ext_tables";
/** 확장별 지운 시점. `dropped_seq` 이하 이벤트는 다시 설치해도 투영하지 않는다(X.operations §4.4.7) */
export const TOMBSTONE_TABLE = "xh_ext_tombstones";

export const LEDGER_MIGRATIONS: MigrationSet = {
  owner: LEDGER_OWNER,
  version: 2,
  steps: [
    {
      version: 1,
      sql: [
        `CREATE TABLE "${LEDGER_TABLE}" ("table" TEXT NOT NULL, "extension" TEXT NOT NULL, ` +
          `"local" TEXT NOT NULL, "projection_version" INTEGER NOT NULL, "created_at" INTEGER NOT NULL, PRIMARY KEY ("table")) STRICT`,
      ],
    },
    {
      version: 2,
      sql: [
        `CREATE TABLE "${TOMBSTONE_TABLE}" ("extension" TEXT NOT NULL, "dropped_seq" INTEGER NOT NULL, "dropped_at" INTEGER NOT NULL, PRIMARY KEY ("extension")) STRICT`,
      ],
    },
  ],
};
