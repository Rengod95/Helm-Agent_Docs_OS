import { assertNever, Bug, ok, type Result } from "@xeon/contracts";
import type {
  DurableEventEnvelope,
  Projector,
  SqlTx,
  StoreDb,
  StoreWriteError,
} from "@xeon/contracts/records";
import { envelopeOfRow, headSeqOf } from "../events.ts";
import { columns, readResult, type RowFault } from "../rows.ts";
import { writeResult } from "../tx-result.ts";
import type { KindCatalog } from "../upcast.ts";
import { toProjectionTx } from "./tx.ts";

/** 재생성이 한 번에 읽는 이벤트 수(eng.events.design §5.4) */
const REBUILD_PAGE = 5000;

function isExtensionKind(kind: string): boolean {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

/**
 * 재생 때 투영기에 넘길 envelope(L1.persistence.spec §4.12):
 * - 등록되지 않은 확장 kind는 업캐스트할 수 없으므로 원본을 그대로 넘긴다. 코어 투영기는 그 이벤트의 payload를 읽지 않고
 *   head와 leaf만 올린다. 확장을 다시 설치하면 그 확장 투영기만 다시 만든다.
 * - 코어 kind를 모르거나 카탈로그보다 높은 version이면(더 새 Xeon이 쓴 이벤트) 투영하지 않고 건너뛴다. 그 thread는
 *   쓰기 모드로 열 수 없고(read_only), 다른 thread의 시작을 막아서는 안 된다.
 * - 업캐스터가 빠진 경우는 코드 결함이다
 */
function upcastForProjection(
  catalog: KindCatalog,
  event: DurableEventEnvelope,
): DurableEventEnvelope | undefined {
  const upcasted = catalog.upcast(event);
  if (upcasted.ok) return upcasted.value;
  switch (upcasted.error.kind) {
    case "unknown_kind":
      return isExtensionKind(event.kind) ? event : undefined;
    case "future_version":
      return undefined;
    case "missing_upcaster":
      throw new Bug(`store.schema_invalid: missing upcaster for ${event.kind} v${event.version}`, {
        cause: upcasted.error,
      });
    default:
      return assertNever(upcasted.error, "upcastForProjection");
  }
}

function acceptsKind(projector: Projector, kind: string): boolean {
  return projector.kinds === "all" || projector.kinds.some((candidate) => candidate === kind);
}

/**
 * 투영기 하나를 다시 만든다: DROP → ddl → events를 seq 순으로 재생 → projector_state 갱신. 호출자의 한 트랜잭션 안이다.
 * 재생은 순수하다: 같은 이벤트 열이면 같은 행이 나온다(D0). 손상된 이벤트 행을 만나면 row_invalid로 멈춘다
 */
export function rebuildProjector(
  tx: SqlTx,
  projector: Projector,
  catalog: KindCatalog,
): Result<void, RowFault> {
  for (const table of [...projector.tables].toReversed()) tx.run(`DROP TABLE IF EXISTS ${table}`);
  for (const sql of projector.ddl) tx.run(sql);
  const projection = toProjectionTx(tx);
  let after = 0;
  for (;;) {
    const rows = tx.all("SELECT envelope FROM events WHERE seq > ? ORDER BY seq LIMIT ?", [
      after,
      REBUILD_PAGE,
    ]);
    if (rows.length === 0) break;
    for (const row of rows) {
      const stored = envelopeOfRow(row);
      if (!stored.ok) return stored;
      after = stored.value.seq;
      if (!acceptsKind(projector, stored.value.kind)) continue;
      const projectable = upcastForProjection(catalog, stored.value);
      if (projectable !== undefined) projector.apply(projection, projectable);
    }
  }
  const head = headSeqOf(tx);
  if (!head.ok) return head;
  tx.run(
    `INSERT INTO projector_state (name, version, last_seq, rebuild_cursor) VALUES (?, ?, ?, NULL)
     ON CONFLICT(name) DO UPDATE SET version = excluded.version, last_seq = excluded.last_seq,
       rebuild_cursor = NULL`,
    [projector.name, projector.version, head.value],
  );
  return ok(undefined);
}

function isStale(tx: SqlTx, projector: Projector): Result<boolean, RowFault> {
  const row = tx.get(
    "SELECT version, last_seq, rebuild_cursor FROM projector_state WHERE name = ?",
    [projector.name],
  );
  if (row === undefined) return ok(true);
  const c = columns(row, "projector_state");
  const version = c.int("version");
  if (!version.ok) return version;
  const lastSeq = c.int("last_seq");
  if (!lastSeq.ok) return lastSeq;
  const cursor = c.nullableString("rebuild_cursor");
  if (!cursor.ok) return cursor;
  const head = headSeqOf(tx);
  if (!head.ok) return head;
  return ok(
    version.value !== projector.version || lastSeq.value !== head.value || cursor.value !== null,
  );
}

/**
 * 투영 버전이 다르거나 last_seq가 head와 다른 투영기만 다시 만든다(§4.5.3). 다시 만든 이름을 돌려준다.
 * 재생성은 투영 버전이 오를 때와 새로 등록할 때만 한다. 열 때마다 하지 않는다
 */
export function ensureProjectors(
  db: StoreDb,
  projectors: readonly Projector[],
  catalog: KindCatalog,
): Result<readonly string[], StoreWriteError | RowFault> {
  const probe = readResult(db, (tx) => {
    const stale: Projector[] = [];
    for (const projector of projectors) {
      const check = isStale(tx, projector);
      if (!check.ok) return check;
      if (check.value) stale.push(projector);
    }
    return ok(stale);
  });
  if (!probe.ok) return probe;
  if (probe.value.length === 0) return ok([]);
  return writeResult(db, (tx): Result<readonly string[], RowFault> => {
    const rebuilt: string[] = [];
    for (const projector of projectors) {
      // 다른 프로세스가 먼저 다시 만들었을 수 있어 트랜잭션 안에서 한 번 더 본다
      const check = isStale(tx, projector);
      if (!check.ok) return check;
      if (!check.value) continue;
      const done = rebuildProjector(tx, projector, catalog);
      if (!done.ok) return done;
      rebuilt.push(projector.name);
    }
    return ok(rebuilt);
  });
}
