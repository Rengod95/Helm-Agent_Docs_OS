// @xeon/core-persistence/testing: 투영을 건드리는 테스트의 도우미(L1.persistence.spec §8.1, eng.testing.guide TS-08).
// 다른 패키지의 테스트 파일에서만 import한다(DR-08).
import { Bug, canonicalJson, err, ok, type Result } from "@xeon/contracts";
import type {
  EventKindRegistry,
  FaultInjector,
  FaultPoint,
  StoreDb,
} from "@xeon/contracts/records";
import { sha256Hex } from "../hash.ts";
import { CORE_PROJECTOR_TABLES, createCoreProjector } from "../projector/core.ts";
import { rebuildProjector } from "../projector/rebuild.ts";
import { createKindCatalog } from "../upcast.ts";

export interface FaultSwitch {
  armed: boolean;
  readonly injector: FaultInjector;
}

/**
 * 지정한 지점에서 예외를 던지는 장애 주입기. armed를 끄면 아무것도 하지 않는다(재제출 성공을 확인할 때).
 * 던지는 값은 Bug("fault:<지점>")이라 어떤 테스트도 이를 예상 실패로 착각하지 않는다
 */
export function faultAt(point: FaultPoint): FaultSwitch {
  const state: FaultSwitch = {
    armed: true,
    injector: {
      hit(hit: FaultPoint): void {
        if (state.armed && hit === point) throw new Bug(`fault:${point}`);
      },
    },
  };
  return state;
}

export interface ProjectionMismatch {
  readonly table: string;
  /** 운영 테이블의 기본 키 정렬 행 해시 */
  readonly live: string;
  /** 지우고 이벤트를 재생해 다시 만든 테이블의 해시 */
  readonly rebuilt: string;
}

/** 이 트랜잭션을 되돌리기 위한 표지. 도우미 밖으로 나가지 않는다 */
const ROLLBACK_PROBE = new Bug("testing.rollback_probe: internal marker, never escapes");

/**
 * 투영 테이블을 모두 지우고 이벤트를 재생한 결과가 지우기 전과 기본 키 정렬 행 해시로 같은지 대조한다.
 * 한 쓰기 트랜잭션 안에서 해시 → 재생성 → 해시를 하고 되돌리므로 데이터는 바뀌지 않는다
 */
export function checkProjectionsRebuildable(
  db: StoreDb,
  options?: { readonly eventKinds?: EventKindRegistry },
): Result<void, readonly ProjectionMismatch[]> {
  const catalog = createKindCatalog(options?.eventKinds);
  const core = createCoreProjector();
  const mismatches: ProjectionMismatch[] = [];
  try {
    db.write((tx): void => {
      const hashOf = (table: string): string =>
        sha256Hex(canonicalJson(tx.all(`SELECT * FROM ${table} ORDER BY 1`)));
      const before = new Map(CORE_PROJECTOR_TABLES.map((table) => [table, hashOf(table)] as const));
      rebuildProjector(tx, core, catalog);
      for (const table of CORE_PROJECTOR_TABLES) {
        const live = before.get(table) ?? "";
        const rebuilt = hashOf(table);
        if (live !== rebuilt) mismatches.push({ table, live, rebuilt });
      }
      throw ROLLBACK_PROBE;
    });
  } catch (caught) {
    if (caught !== ROLLBACK_PROBE) throw caught;
  }
  return mismatches.length === 0 ? ok(undefined) : err(mismatches);
}

/** 모든 투영 테스트의 끝에 부른다. 어긋나면 투영기 버그다 */
export function expectProjectionsRebuildable(
  db: StoreDb,
  options?: { readonly eventKinds?: EventKindRegistry },
): void {
  const checked = checkProjectionsRebuildable(db, options);
  if (!checked.ok) {
    const tables = checked.error.map((mismatch) => mismatch.table).join(", ");
    throw new Bug(`projection rebuild differs from the live projection: ${tables}`, {
      cause: checked.error,
    });
  }
}
