import type { MigrationSet, StoreService } from "@xeon/contracts/records";

/** 소유자 한 곳의 한 단계짜리 마이그레이션을 적용한다. 실패하면 던져서 테스트를 멈춘다 */
export function applyTables(service: StoreService, owner: string, sql: readonly string[]): void {
  const set: MigrationSet = { owner, version: 1, steps: [{ version: 1, sql }] };
  const result = service.migrations.apply(set);
  if (!result.ok) throw new Error(`migration failed: ${result.error.kind}`);
}
