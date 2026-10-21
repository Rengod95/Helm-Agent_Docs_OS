export type GuardViolation =
  | { readonly kind: "foreign_table"; readonly table: string }
  | { readonly kind: "forbidden_statement"; readonly keyword: string }
  | { readonly kind: "multiple_statements" };

const FORBIDDEN = ["ATTACH", "DETACH", "PRAGMA", "VACUUM"] as const;

/** 테이블·인덱스 이름이 오는 자리. 따옴표 식별자 또는 공백 전까지 */
const REFERENCE =
  /\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INDEX(?:\s+IF\s+NOT\s+EXISTS)?|ON)\s+("(?:[^"]|"")*"|[^\s(,;]+)/gi;

/** 문자열 리터럴 속 내용을 지워 키워드·세미콜론 검사의 오탐을 막는다 */
function stripLiterals(sql: string): string {
  return sql.replaceAll(/'(?:[^']|'')*'/g, "''");
}

function unquote(identifier: string): string {
  return identifier.startsWith('"') ? identifier.slice(1, -1).replaceAll('""', '"') : identifier;
}

/**
 * 생성된 SQL 한 문장의 방어 검사. 접두 밖 테이블, 금지 키워드(ATTACH, DETACH, PRAGMA, VACUUM, sqlite_), 여러 문장을 거부한다.
 * X가 만든 문장에만 적용하는 겹친 방어이고 테스트·디버그 빌드에서 켠다(X.operations.spec §4.4.4, §4.4.6)
 */
export function checkStatement(sql: string, prefix: string): readonly GuardViolation[] {
  const violations: GuardViolation[] = [];
  const body = stripLiterals(sql).trim();
  const withoutTrailing = body.endsWith(";") ? body.slice(0, -1) : body;
  if (withoutTrailing.includes(";")) violations.push({ kind: "multiple_statements" });
  const upper = withoutTrailing.toUpperCase();
  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
      violations.push({ kind: "forbidden_statement", keyword });
    }
  }
  if (/sqlite_/i.test(withoutTrailing)) {
    violations.push({ kind: "forbidden_statement", keyword: "sqlite_" });
  }
  for (const match of withoutTrailing.matchAll(REFERENCE)) {
    const reference = match[1];
    if (reference === undefined) continue;
    const table = unquote(reference);
    if (!table.startsWith(prefix)) violations.push({ kind: "foreign_table", table });
  }
  return violations;
}
