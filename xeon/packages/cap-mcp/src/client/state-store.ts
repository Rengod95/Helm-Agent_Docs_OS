import { err, ok, type Clock, type Result } from "@xeon/contracts";
import type { McpServerState } from "@xeon/contracts/capabilities";
import type {
  MigrationError,
  MigrationSet,
  SqlRow,
  StoreReadError,
  StoreWriteError,
} from "@xeon/contracts/records";
import type { McpMasker } from "../ports/secrets.ts";
import type { McpStorePort } from "../ports/store.ts";

// L2.mcp.spec §3.5. 세션 밖 상태 표 `cap_mcp_servers`. 재생으로 다시 만들지 않는다. 재시작 뒤 화면이 마지막 오류를
// 보여 주는 용도다. 소유자 `cap.mcp`, 테이블 접두 `cap_mcp_`. 오류 메시지는 저장 전에 마스킹한다.

export const MCP_STORE_OWNER = "cap.mcp";

export const CAP_MCP_MIGRATIONS: MigrationSet = {
  owner: MCP_STORE_OWNER,
  version: 1,
  steps: [
    {
      version: 1,
      sql: [
        `CREATE TABLE cap_mcp_servers (
  server_id          TEXT PRIMARY KEY,
  source             TEXT NOT NULL,
  state              TEXT NOT NULL,
  last_error_code    TEXT,
  last_error_message TEXT,
  last_error_at      INTEGER,
  last_connected_at  INTEGER,
  protocol_version   TEXT,
  tools_fingerprint  TEXT,
  updated_at         INTEGER NOT NULL
) STRICT`,
      ],
    },
  ],
};

interface StoredServerState {
  readonly serverId: string;
  readonly source: string;
  readonly state: McpServerState;
  readonly lastError:
    | { readonly code: string; readonly message: string; readonly at: number }
    | undefined;
  readonly lastConnectedAt: number | undefined;
  readonly protocolVersion: string | undefined;
  readonly toolsFingerprint: string | undefined;
}

type StateStoreError =
  | { readonly kind: "migrate"; readonly error: MigrationError }
  | { readonly kind: "write"; readonly error: StoreWriteError }
  | { readonly kind: "read"; readonly error: StoreReadError }
  | { readonly kind: "row_invalid"; readonly serverId: string };

export interface StateStore {
  migrate(): Result<void, StateStoreError>;
  save(row: StoredServerState): Result<void, StateStoreError>;
  load(serverId: string): Result<StoredServerState | undefined, StateStoreError>;
  remove(serverId: string): Result<void, StateStoreError>;
}

const STATES: readonly McpServerState[] = [
  "disabled",
  "connecting",
  "connected",
  "reconnecting",
  "failed",
  "blocked",
];

function stateOf(value: unknown): McpServerState | undefined {
  return STATES.find((candidate) => candidate === value);
}

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function integer(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  return typeof value === "number" ? value : undefined;
}

function rowOf(row: SqlRow): StoredServerState | undefined {
  const serverId = text(row, "server_id");
  const source = text(row, "source");
  const state = stateOf(row["state"]);
  if (serverId === undefined || source === undefined || state === undefined) return undefined;
  const code = text(row, "last_error_code");
  const message = text(row, "last_error_message");
  const at = integer(row, "last_error_at");
  return {
    serverId,
    source,
    state,
    lastError:
      code !== undefined && message !== undefined && at !== undefined
        ? { code, message, at }
        : undefined,
    lastConnectedAt: integer(row, "last_connected_at"),
    protocolVersion: text(row, "protocol_version"),
    toolsFingerprint: text(row, "tools_fingerprint"),
  };
}

export function createStateStore(deps: {
  readonly store: McpStorePort;
  readonly clock: Clock;
  readonly masker: McpMasker;
}): StateStore {
  const db = (): ReturnType<McpStorePort["scoped"]> => deps.store.scoped(MCP_STORE_OWNER);
  return {
    migrate() {
      const applied = deps.store.migrations.apply(CAP_MCP_MIGRATIONS);
      return applied.ok ? ok(undefined) : err({ kind: "migrate", error: applied.error });
    },
    save(row) {
      const written = db().write((tx) =>
        tx.run(
          `INSERT INTO cap_mcp_servers (server_id, source, state, last_error_code, last_error_message,
             last_error_at, last_connected_at, protocol_version, tools_fingerprint, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id) DO UPDATE SET
             source = excluded.source, state = excluded.state,
             last_error_code = excluded.last_error_code, last_error_message = excluded.last_error_message,
             last_error_at = excluded.last_error_at, last_connected_at = excluded.last_connected_at,
             protocol_version = excluded.protocol_version, tools_fingerprint = excluded.tools_fingerprint,
             updated_at = excluded.updated_at`,
          [
            row.serverId,
            row.source,
            row.state,
            row.lastError?.code ?? null,
            row.lastError === undefined ? null : deps.masker.mask(row.lastError.message),
            row.lastError?.at ?? null,
            row.lastConnectedAt ?? null,
            row.protocolVersion ?? null,
            row.toolsFingerprint ?? null,
            deps.clock.now(),
          ],
        ),
      );
      return written.ok ? ok(undefined) : err({ kind: "write", error: written.error });
    },
    load(serverId) {
      const read = db().read((tx) =>
        tx.get("SELECT * FROM cap_mcp_servers WHERE server_id = ?", [serverId]),
      );
      if (!read.ok) return err({ kind: "read", error: read.error });
      if (read.value === undefined) return ok(undefined);
      const row = rowOf(read.value);
      return row === undefined ? err({ kind: "row_invalid", serverId }) : ok(row);
    },
    remove(serverId) {
      const removed = db().write((tx) =>
        tx.run("DELETE FROM cap_mcp_servers WHERE server_id = ?", [serverId]),
      );
      return removed.ok ? ok(undefined) : err({ kind: "write", error: removed.error });
    },
  };
}
