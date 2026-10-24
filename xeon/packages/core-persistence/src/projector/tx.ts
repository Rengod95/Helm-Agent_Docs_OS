import { Bug } from "@xeon/contracts";
import type { ProjectionTx, SqlRow, SqlTx, SqlValue } from "@xeon/contracts/records";

/** 문장이 건드리는 테이블 이름 자리. INSERT/REPLACE INTO, UPDATE, DELETE FROM, FROM, JOIN, CREATE/DROP TABLE, CREATE INDEX ... ON */
const TABLE_REFERENCE =
  /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|FROM|JOIN|CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ON)\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_]\w*)/gi;

const FORBIDDEN_STATEMENT = /\b(?:ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

function unquote(name: string): string {
  const first = name.charAt(0);
  return first === '"' || first === "`" || first === "[" ? name.slice(1, -1) : name;
}

/** 투영기 문장이 소유 테이블만 건드리는지 본다. 어긋나면 이유를 돌려준다 */
function violationOf(sql: string, owned: ReadonlySet<string>): string | null {
  if (FORBIDDEN_STATEMENT.test(sql)) return "statement is not allowed in a projector";
  if (/;\s*\S/.test(sql)) return "one statement per call";
  for (const match of sql.matchAll(TABLE_REFERENCE)) {
    const name = unquote(match[1] ?? "");
    if (name.toLowerCase().startsWith("sqlite_")) return `${name} is an internal table`;
    // 하위 질의의 괄호나 SQLite 함수 이름은 식별자 규칙을 따르지 않아 위 정규식에 걸리지 않는다
    if (!owned.has(name)) return `${name} is not a table of this projector`;
  }
  return null;
}

/**
 * 커밋 트랜잭션의 SqlTx를 투영기용 핸들로 감싼다. 투영기는 변경 건수를 보지 않는다.
 * `ownedTables`를 주면(테스트·디버그 빌드의 확장·능력 투영기) 소유하지 않은 테이블을 건드리는 문장을
 * `Bug("store.prefix_not_owned")`로 거부하고 커밋 전체가 롤백된다(L1.persistence.spec §4.5.2)
 */
export function toProjectionTx(tx: SqlTx, ownedTables?: readonly string[]): ProjectionTx {
  const owned = ownedTables === undefined ? undefined : new Set(ownedTables);
  const check = (sql: string): void => {
    if (owned === undefined) return;
    const violation = violationOf(sql, owned);
    if (violation !== null) {
      throw new Bug(`store.prefix_not_owned: ${violation}`);
    }
  };
  return {
    run(sql: string, params?: readonly SqlValue[]): void {
      check(sql);
      tx.run(sql, params);
    },
    get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined {
      check(sql);
      return tx.get(sql, params);
    },
    all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[] {
      check(sql);
      return tx.all(sql, params);
    },
  };
}
