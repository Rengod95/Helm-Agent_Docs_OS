import { Bug, err, ok, type Clock, type Result } from "@xeon/contracts";
import { extTablePrefix } from "@xeon/contracts/records";
import type {
  ExtensionTableError,
  ExtensionTables,
  StoreWriteError,
} from "@xeon/contracts/records";
import { assertNotInWrite, createStoreDb, type StoreConnections } from "./db.ts";
import { checkExtName, extOwnerId, isExtTableOf } from "./prefix.ts";

export interface ExtensionTablesDeps {
  readonly conn: StoreConnections;
  readonly clock: Clock;
}

function mapWriteError(error: StoreWriteError): ExtensionTableError {
  switch (error.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code: error.code };
    default:
      throw new Bug("store.write_error_invalid");
  }
}

/** 따옴표로 감싼 식별자. 호출자가 소유 판정(x_<id>_ + 지역 이름)을 통과시킨 이름만 넘긴다 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** 확장 접두사 테이블 등록·삭제(L0.store.spec §4.5) */
export function createExtensionTables(deps: ExtensionTablesDeps): ExtensionTables {
  const { conn, clock } = deps;
  const db = createStoreDb(conn, { internal: true });

  return {
    register(
      name: string,
    ): Result<{ readonly owner: string; readonly tablePrefix: string }, ExtensionTableError> {
      const checked = checkExtName(name);
      if (!checked.ok) return err({ kind: "ext_id_invalid", name, reason: checked.reason });
      assertNotInWrite(conn.state, "extensions.register");
      const owner = extOwnerId(name);
      const tablePrefix = extTablePrefix(name);
      const written = db.write((tx): void => {
        tx.run(
          `INSERT INTO sys_prefixes (owner, kind, names, registered_at) VALUES (?, 'extension', ?, ?)
           ON CONFLICT(owner) DO NOTHING`,
          [owner, JSON.stringify([tablePrefix]), clock.now()],
        );
      });
      if (!written.ok) return err(mapWriteError(written.error));
      return ok({ owner, tablePrefix });
    },
    drop(
      name: string,
      tables: readonly string[],
    ): Result<{ readonly dropped: readonly string[] }, ExtensionTableError> {
      const checked = checkExtName(name);
      if (!checked.ok) return err({ kind: "ext_id_invalid", name, reason: checked.reason });
      assertNotInWrite(conn.state, "extensions.drop");
      // 하나라도 이 확장의 것이 아니면 아무것도 지우지 않는다. LIKE 같은 접두 패턴 삭제는 하지 않는다
      for (const table of tables) {
        if (!isExtTableOf(name, table)) return err({ kind: "table_not_owned", name, table });
      }
      const owner = extOwnerId(name);
      const written = db.write((tx): readonly string[] => {
        const dropped: string[] = [];
        for (const table of tables) {
          const present = tx.get(
            "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
            [table],
          );
          if (present === undefined) continue;
          tx.run(`DROP TABLE ${quoteIdentifier(table)}`);
          dropped.push(table);
        }
        tx.run("DELETE FROM sys_migrations WHERE owner = ?", [owner]);
        tx.run("DELETE FROM sys_migration_cursors WHERE owner = ?", [owner]);
        tx.run("DELETE FROM sys_prefixes WHERE owner = ? AND kind = 'extension'", [owner]);
        return dropped;
      });
      if (!written.ok) return err(mapWriteError(written.error));
      return ok({ dropped: written.value });
    },
  };
}
