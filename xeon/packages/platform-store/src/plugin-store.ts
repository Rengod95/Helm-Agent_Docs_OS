import { Bug, err, ok, type Clock, type Result } from "@fresnel/contracts";
import {
  PLUGIN_STORE_LIMITS,
  type ExtensionName,
  type PluginStoreError,
  type PluginStorePort,
  type PluginStoreRow,
  type PluginStoreUsage,
} from "@fresnel/contracts/extensions";
import type { SqlTx } from "@fresnel/contracts/records";
import { createStoreDb, type StoreConnections } from "./db.ts";
import { columnInt, columnString } from "./rows.ts";

export interface PluginStoreDeps {
  readonly conn: StoreConnections;
  readonly clock: Clock;
}

const encoder = new TextEncoder();

/** 닫힌 저장소의 실패. 원인을 싣지 않는다 */
const CLOSED: PluginStoreError = { kind: "storage_unavailable" };

/** 저장소 실패(busy, disk_full, io)는 모두 storage_unavailable이다. 원인은 cause에 그대로 싣는다 */
function unavailable(cause: unknown): PluginStoreError {
  return { kind: "storage_unavailable", cause };
}

/** 이름 공간 하나의 행 수와 바이트 합. 집계 질의는 항상 한 행이므로 없으면 코드 결함이다 */
function usageOf(tx: SqlTx, extension: ExtensionName): PluginStoreUsage {
  const row = tx.get(
    "SELECT COUNT(*) AS keys, COALESCE(SUM(bytes), 0) AS bytes FROM sys_plugin_store WHERE extension = ?",
    [extension],
  );
  if (row === undefined) throw new Bug("store.engine_shape: plugin store usage returned no row");
  return { keys: columnInt(row, "keys"), bytes: columnInt(row, "bytes") };
}

/**
 * 플러그인 전용 저장소 포트(X.primitives.spec §4.6.7, L0.store.spec §3.3 sys v4). 행 하나가 (확장 이름, 키) 하나다.
 * 표 `sys_plugin_store`는 `sys_` 접두라 sys 소유이고 루트 핸들로만 읽고 쓴다(범위 핸들을 만들지 않는다).
 * 형식과 값 크기는 ext-host가 먼저 본다. 여기서는 키 수와 총량을 쓰기 트랜잭션 안에서 다시 세어,
 * 두 쓰기가 한도를 함께 넘기는 틈을 막는다. 닫힌 저장소와 읽기 전용 열기의 쓰기는 실패 값이다(던지지 않는다).
 */
export function createPluginStorePort(deps: PluginStoreDeps): PluginStorePort {
  const { conn, clock } = deps;
  const db = createStoreDb(conn);

  function read<T>(fn: (tx: SqlTx) => Result<T, PluginStoreError>): Result<T, PluginStoreError> {
    if (conn.state.phase !== "open") return err(CLOSED);
    const done = db.read(fn);
    if (!done.ok) return err(unavailable(done.error));
    return done.value;
  }

  function write<T>(fn: (tx: SqlTx) => Result<T, PluginStoreError>): Result<T, PluginStoreError> {
    if (conn.state.phase !== "open") return err(CLOSED);
    const done = db.write(fn);
    if (!done.ok) return err(unavailable(done.error));
    return done.value;
  }

  return {
    get(extension, key) {
      return Promise.resolve(
        read<string | null>((tx) => {
          const row = tx.get("SELECT value FROM sys_plugin_store WHERE extension = ? AND key = ?", [
            extension,
            key,
          ]);
          return ok(row === undefined ? null : columnString(row, "value"));
        }),
      );
    },

    put(extension, key, valueJson) {
      const bytes = encoder.encode(valueJson).byteLength;
      return Promise.resolve(
        write<void>((tx) => {
          const previous = tx.get(
            "SELECT bytes FROM sys_plugin_store WHERE extension = ? AND key = ?",
            [extension, key],
          );
          const usage = usageOf(tx, extension);
          const replacedBytes = previous === undefined ? 0 : columnInt(previous, "bytes");
          const keys = usage.keys + (previous === undefined ? 1 : 0);
          const totalBytes = usage.bytes - replacedBytes + bytes;
          if (keys > PLUGIN_STORE_LIMITS.keys || totalBytes > PLUGIN_STORE_LIMITS.totalBytes) {
            return err<PluginStoreError>({ kind: "store_full" });
          }
          tx.run(
            `INSERT INTO sys_plugin_store (extension, key, value, bytes, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(extension, key) DO UPDATE SET value = excluded.value, bytes = excluded.bytes, updated_at = excluded.updated_at`,
            [extension, key, valueJson, bytes, clock.now()],
          );
          return ok(undefined);
        }),
      );
    },

    delete(extension, key) {
      return Promise.resolve(
        write<void>((tx) => {
          tx.run("DELETE FROM sys_plugin_store WHERE extension = ? AND key = ?", [extension, key]);
          return ok(undefined);
        }),
      );
    },

    list(extension, prefix) {
      return Promise.resolve(
        read<readonly PluginStoreRow[]>((tx) => {
          const rows = tx.all(
            "SELECT key, value FROM sys_plugin_store WHERE extension = ? AND substr(key, 1, length(?)) = ? ORDER BY key",
            [extension, prefix, prefix],
          );
          return ok(
            rows.map((row) => ({
              key: columnString(row, "key"),
              valueJson: columnString(row, "value"),
            })),
          );
        }),
      );
    },

    usage(extension) {
      return Promise.resolve(read<PluginStoreUsage>((tx) => ok(usageOf(tx, extension))));
    },

    clear(extension) {
      return Promise.resolve(
        write<void>((tx) => {
          tx.run("DELETE FROM sys_plugin_store WHERE extension = ?", [extension]);
          return ok(undefined);
        }),
      );
    },
  };
}
