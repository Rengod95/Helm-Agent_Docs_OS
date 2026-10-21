import { Bug } from "@xeon/contracts";
import {
  CONTEXTS,
  EXT_ID_PATTERN,
  RESERVED_EXT_IDS,
  TABLE_PREFIX_OWNERS,
  extTablePrefix,
} from "@xeon/contracts/records";
import { toSqlRow, columnInt, columnString } from "./rows.ts";
import type { SqliteConnection } from "./sqlite-env.ts";

export type OwnerKind = "core" | "extension";

/** 소유자 하나의 이름 집합. names는 접두("p_", 끝이 "_") 또는 정확한 이름("events") */
export interface OwnerSpec {
  readonly owner: string;
  readonly kind: OwnerKind;
  readonly names: readonly string[];
}

/** 확장 테이블의 지역 이름 규칙(밑줄 없음). X.operations.spec §3.4 parseExtTableName과 같은 규칙이다 */
const EXT_LOCAL_NAME = /^[a-z][a-z0-9]{0,31}$/;
const EXT_ID = new RegExp(EXT_ID_PATTERN);

export const SYS_OWNER = "sys";
const CORE_PERSISTENCE_OWNER = "core.persistence";

/** 루트 핸들만 쓸 수 있는 소유자. scoped(owner)는 Bug다 */
export function isRootOnlyOwner(owner: string): boolean {
  return owner === SYS_OWNER || owner === CORE_PERSISTENCE_OWNER;
}

export function extOwnerId(extName: string): string {
  return `ext.${extName}`;
}

export type ExtNameCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "pattern" | "reserved" };

export function checkExtName(name: string): ExtNameCheck {
  if (!EXT_ID.test(name)) return { ok: false, reason: "pattern" };
  if (RESERVED_EXT_IDS.includes(name)) return { ok: false, reason: "reserved" };
  return { ok: true };
}

/** 확장 `extName`의 테이블인가. 접두 일치만으로 판정하지 않고 나머지(지역 이름)가 밑줄 없는 이름이어야 한다 */
export function isExtTableOf(extName: string, table: string): boolean {
  const prefix = extTablePrefix(extName);
  if (!table.startsWith(prefix)) return false;
  return EXT_LOCAL_NAME.test(table.slice(prefix.length));
}

function matchesCoreName(name: string, table: string): boolean {
  if (name.endsWith("_")) return table.startsWith(name);
  // 정확한 이름 N은 N 자신과 N_ 로 시작하는 객체(인덱스 등)를 소유한다
  return table === name || table.startsWith(`${name}_`);
}

export function ownsTable(spec: OwnerSpec, table: string): boolean {
  switch (spec.kind) {
    case "core":
      return spec.names.some((name) => matchesCoreName(name, table));
    case "extension":
      return spec.names.some((prefix) => {
        if (!table.startsWith(prefix)) return false;
        return EXT_LOCAL_NAME.test(table.slice(prefix.length));
      });
    default:
      throw new Bug(`store.owner_kind_invalid: ${String(spec.kind)}`);
  }
}

/** F의 TABLE_PREFIX_OWNERS(컨텍스트 id)와 CONTEXTS(생산자 id)에서 코어 소유자 표를 만든다. 표를 따로 베끼지 않는다 */
export function coreOwnerSpecs(): readonly OwnerSpec[] {
  const byOwner = new Map<string, string[]>();
  for (const [name, contextId] of Object.entries(TABLE_PREFIX_OWNERS)) {
    const context = CONTEXTS.find((candidate) => candidate.id === contextId);
    if (context === undefined) {
      throw new Bug(`store.owner_table_invalid: unknown context ${contextId} for ${name}`);
    }
    const owner = contextId === "platform-store" ? SYS_OWNER : context.producers[0];
    if (owner === undefined) {
      throw new Bug(`store.owner_table_invalid: context ${contextId} has no producer`);
    }
    const names = byOwner.get(owner) ?? [];
    names.push(name);
    byOwner.set(owner, names);
  }
  return [...byOwner].map(([owner, names]): OwnerSpec => ({ owner, kind: "core", names }));
}

// ── 문장 분류와 DDL 어휘 분석 ───────────────────────────────────────────

interface Token {
  /** 식별자·키워드는 그대로, 따옴표 식별자는 따옴표를 벗긴 값. 구두점은 한 글자 */
  readonly text: string;
  readonly quoted: boolean;
}

function isWordStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isWordPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/** 문장 앞머리 토큰만 뽑는다. 주석과 공백을 건너뛴다 */
function tokenize(sql: string, limit: number): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length && tokens.length < limit) {
    const ch = sql.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === "-" && sql.charAt(i + 1) === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (ch === "/" && sql.charAt(i + 1) === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === '"' || ch === "`" || ch === "'") {
      let j = i + 1;
      let text = "";
      while (j < sql.length) {
        if (sql.charAt(j) === ch) {
          if (sql.charAt(j + 1) === ch) {
            text += ch;
            j += 2;
            continue;
          }
          break;
        }
        text += sql.charAt(j);
        j += 1;
      }
      tokens.push({ text, quoted: true });
      i = j + 1;
    } else if (ch === "[") {
      const end = sql.indexOf("]", i + 1);
      const stop = end === -1 ? sql.length : end;
      tokens.push({ text: sql.slice(i + 1, stop), quoted: true });
      i = stop + 1;
    } else if (isWordStart(ch)) {
      let j = i + 1;
      while (j < sql.length && isWordPart(sql.charAt(j))) j += 1;
      tokens.push({ text: sql.slice(i, j), quoted: false });
      i = j;
    } else {
      tokens.push({ text: ch, quoted: false });
      i += 1;
    }
  }
  return tokens;
}

function keyword(token: Token | undefined): string {
  return token === undefined || token.quoted ? "" : token.text.toUpperCase();
}

type DdlObject = "TABLE" | "INDEX" | "VIEW" | "TRIGGER";

export type StatementClass =
  | {
      readonly kind: "ddl";
      readonly object: DdlObject | null;
      readonly targets: readonly string[];
      readonly parsed: boolean;
    }
  | { readonly kind: "attach" }
  /** 범위 핸들에서 쓸 수 없는 문장: 트랜잭션 제어(관리하는 트랜잭션을 깨뜨린다)와 DB 전체에 걸치는 유지 작업 */
  | { readonly kind: "forbidden"; readonly keyword: string }
  | {
      readonly kind: "pragma";
      readonly write: boolean;
      readonly name: string;
      readonly tables: readonly string[];
    }
  | { readonly kind: "other" };

const DDL_OBJECTS: ReadonlySet<string> = new Set(["TABLE", "INDEX", "VIEW", "TRIGGER"]);
const FORBIDDEN_KEYWORDS: ReadonlySet<string> = new Set([
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
]);

function ddlObjectOf(word: string): DdlObject | null {
  switch (word) {
    case "TABLE":
    case "INDEX":
    case "VIEW":
    case "TRIGGER":
      return word;
    default:
      return null;
  }
}
const READ_PRAGMAS_WITH_TABLE: ReadonlySet<string> = new Set([
  "table_info",
  "table_xinfo",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
]);

/** 이름 토큰 하나를 읽는다. `schema . name`이면 name을 돌려준다. 다음 위치도 돌려준다 */
function readObjectName(
  tokens: readonly Token[],
  start: number,
): { readonly name: string; readonly next: number } | undefined {
  const first = tokens[start];
  if (first === undefined || (!first.quoted && !isWordStart(first.text.charAt(0))))
    return undefined;
  if (tokens[start + 1]?.text === "." && tokens[start + 1]?.quoted === false) {
    const second = tokens[start + 2];
    if (second === undefined) return undefined;
    return { name: second.text, next: start + 3 };
  }
  return { name: first.text, next: start + 1 };
}

function classifyDdl(tokens: readonly Token[]): StatementClass {
  const head = keyword(tokens[0]);
  let i = 1;
  if (head === "CREATE") {
    while (["TEMP", "TEMPORARY", "UNIQUE", "VIRTUAL"].includes(keyword(tokens[i]))) i += 1;
  }
  const object = keyword(tokens[i]);
  if (head === "ALTER" ? object !== "TABLE" : !DDL_OBJECTS.has(object)) {
    return { kind: "ddl", object: null, targets: [], parsed: false };
  }
  const kindOfObject = ddlObjectOf(object);
  i += 1;
  if (keyword(tokens[i]) === "IF") {
    i += 1;
    if (keyword(tokens[i]) === "NOT") i += 1;
    i += 1; // EXISTS
  }
  const name = readObjectName(tokens, i);
  if (name === undefined) return { kind: "ddl", object: kindOfObject, targets: [], parsed: false };
  const targets = [name.name];
  if (head === "CREATE" && (object === "INDEX" || object === "TRIGGER")) {
    let j = name.next;
    while (j < tokens.length && keyword(tokens[j]) !== "ON") j += 1;
    const table = readObjectName(tokens, j + 1);
    if (table === undefined) {
      return { kind: "ddl", object: kindOfObject, targets: [], parsed: false };
    }
    targets.push(table.name);
  }
  return { kind: "ddl", object: kindOfObject, targets, parsed: true };
}

function classifyPragma(tokens: readonly Token[]): StatementClass {
  const name = readObjectName(tokens, 1);
  if (name === undefined) return { kind: "pragma", write: true, name: "", tables: [] };
  const after = tokens[name.next]?.text;
  const lowered = name.name.toLowerCase();
  if (after === "(" && READ_PRAGMAS_WITH_TABLE.has(lowered)) {
    const table = tokens[name.next + 1];
    return {
      kind: "pragma",
      write: false,
      name: lowered,
      tables: table === undefined ? [] : [table.text],
    };
  }
  return { kind: "pragma", write: true, name: lowered, tables: [] };
}

/** 문장 앞머리로 종류를 나눈다. DDL이면 대상 이름을 뽑는다. 순수 함수 */
export function classifyStatement(sql: string): StatementClass {
  const tokens = tokenize(sql, 16);
  const head = keyword(tokens[0]);
  if (FORBIDDEN_KEYWORDS.has(head)) return { kind: "forbidden", keyword: head };
  switch (head) {
    case "CREATE":
    case "DROP":
    case "ALTER":
      return classifyDdl(tokens);
    case "ATTACH":
    case "DETACH":
      return { kind: "attach" };
    case "PRAGMA":
      return classifyPragma(tokens);
    default:
      return { kind: "other" };
  }
}

/** 문장 끝 `;` 뒤에 또 다른 문장이 있는가. 따옴표와 주석 안의 `;`는 세지 않는다 */
export function hasMultipleStatements(sql: string): boolean {
  const tokens = tokenize(sql, Number.MAX_SAFE_INTEGER);
  const firstSemicolon = tokens.findIndex((token) => !token.quoted && token.text === ";");
  return firstSemicolon !== -1 && firstSemicolon < tokens.length - 1;
}

// ── 문장 검사기 ─────────────────────────────────────────────────────────

export interface StatementGuard {
  /** 문장을 실행하기 전에 부른다. 위반이면 Bug를 던진다 */
  check(sql: string, db: SqliteConnection): void;
}

export interface GuardOptions {
  readonly spec: OwnerSpec;
  /** 테스트·디버그 빌드: 모든 문장을 EXPLAIN으로 대조한다 */
  readonly strict: boolean;
  /** 마이그레이션 안에서만 true */
  readonly allowDdl: boolean;
}

interface RootPageTable {
  readonly schemaVersion: number;
  readonly byPage: ReadonlyMap<number, string>;
}

function schemaVersionOf(db: SqliteConnection): number {
  const row = db.query<unknown, []>("PRAGMA schema_version").get();
  return columnInt(toSqlRow(row), "schema_version");
}

function readRootPages(db: SqliteConnection, schema: "main" | "temp"): ReadonlyMap<number, string> {
  const rows = db
    .query<unknown, []>(`SELECT rootpage, tbl_name FROM ${schema}.sqlite_schema WHERE rootpage > 0`)
    .all();
  const byPage = new Map<number, string>();
  for (const raw of rows) {
    const row = toSqlRow(raw);
    byPage.set(columnInt(row, "rootpage"), columnString(row, "tbl_name"));
  }
  return byPage;
}

const OPEN_OPCODES: ReadonlySet<string> = new Set(["OpenRead", "OpenWrite", "ReopenIdx"]);
/** OPFLAG_P2ISREG: p2가 루트 페이지가 아니라 레지스터 번호 */
const P2_IS_REGISTER = 0x02;

export function createStatementGuard(options: GuardOptions): StatementGuard {
  const { spec, strict, allowDdl } = options;
  const verified = new Set<string>();
  let mainPages: RootPageTable | undefined;
  let tempPages: RootPageTable | undefined;

  const violation = (message: string): never => {
    throw new Bug(`store.prefix_not_owned: ${spec.owner} ${message}`);
  };

  const requireOwned = (table: string): void => {
    if (table.startsWith("sqlite_")) return;
    if (!ownsTable(spec, table)) violation(`does not own ${table}`);
  };

  const pagesOf = (db: SqliteConnection, schema: "main" | "temp"): ReadonlyMap<number, string> => {
    const version = schemaVersionOf(db);
    const cached = schema === "main" ? mainPages : tempPages;
    if (cached !== undefined && cached.schemaVersion === version) return cached.byPage;
    const fresh: RootPageTable = { schemaVersion: version, byPage: readRootPages(db, schema) };
    if (schema === "main") mainPages = fresh;
    else tempPages = fresh;
    return fresh.byPage;
  };

  const checkRootPage = (
    db: SqliteConnection,
    page: number,
    dbIndex: number,
    writing: boolean,
  ): void => {
    if (page === 1) {
      if (writing && !allowDdl) violation("cannot write sqlite_schema");
      return;
    }
    const table = pagesOf(db, dbIndex === 1 ? "temp" : "main").get(page);
    if (table === undefined) violation(`touches unknown root page ${page}`);
    else requireOwned(table);
  };

  const explainCheck = (sql: string, db: SqliteConnection): void => {
    // 캐시되는 db.query로 EXPLAIN을 돌리면 문장이 끝나지 않은 채 남아 트랜잭션 COMMIT이 SQLITE_BUSY가 된다
    // (Bun 1.4.3 실측). 캐시하지 않는 prepare로 돌리고 바로 finalize한다
    const statement = db.prepare<unknown, []>(`EXPLAIN ${sql}`);
    let rows: readonly unknown[];
    try {
      rows = statement.all();
    } finally {
      statement.finalize();
    }
    for (const raw of rows) {
      const row = toSqlRow(raw);
      const opcode = columnString(row, "opcode");
      // Clear는 WHERE 없는 DELETE의 truncate 최적화다. 루트 페이지는 p1, 데이터베이스 번호는 p2다
      if (opcode === "Clear") {
        checkRootPage(db, columnInt(row, "p1"), columnInt(row, "p2"), true);
        continue;
      }
      if (!OPEN_OPCODES.has(opcode)) continue;
      if ((columnInt(row, "p5") & P2_IS_REGISTER) !== 0) continue;
      checkRootPage(db, columnInt(row, "p2"), columnInt(row, "p3"), opcode === "OpenWrite");
    }
  };

  return {
    check(sql: string, db: SqliteConnection): void {
      if (verified.has(sql)) return;
      const cls = classifyStatement(sql);
      if (cls.kind !== "ddl" || cls.object !== "TRIGGER") {
        // 트리거 본문의 `;`는 한 문장의 일부다. 그 밖에는 문장 하나만 허용한다
        if (hasMultipleStatements(sql)) {
          throw new Bug("store.statement_forbidden: only one statement per call is allowed");
        }
      }
      switch (cls.kind) {
        case "forbidden":
          throw new Bug(
            `store.statement_forbidden: ${cls.keyword} is not allowed on a scoped handle`,
          );
        case "attach":
          throw new Bug(
            "store.statement_forbidden: ATTACH and DETACH are not allowed on a scoped handle",
          );
        case "pragma":
          if (cls.write) {
            throw new Bug(
              `store.statement_forbidden: PRAGMA ${cls.name} is not allowed on a scoped handle`,
            );
          }
          for (const table of cls.tables) requireOwned(table);
          break;
        case "ddl":
          if (!allowDdl) {
            throw new Bug("store.ddl_outside_migration: DDL is allowed only inside a migration");
          }
          if (!cls.parsed) violation("runs DDL whose target could not be determined");
          if (spec.kind === "extension" && (cls.object === "TRIGGER" || cls.object === "VIEW")) {
            // 본문이 다른 테이블을 가리켜도 어휘 분석으로는 알 수 없으므로 확장에는 열지 않는다
            throw new Bug(
              `store.statement_forbidden: ${cls.object} is not allowed for extension ${spec.owner}`,
            );
          }
          for (const target of cls.targets) requireOwned(target);
          break;
        case "other":
          if (strict) explainCheck(sql, db);
          break;
        default:
          throw new Bug("store.statement_class_invalid");
      }
      verified.add(sql);
    },
  };
}

/** 테스트·디버그 빌드 판정. 운영 빌드는 DDL 어휘 검사만 한다(L0.store.spec §4.5) */
export function isStrictBuild(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env["XEON_STORE_STRICT"] === "1") return true;
  return env["NODE_ENV"] !== "production";
}
