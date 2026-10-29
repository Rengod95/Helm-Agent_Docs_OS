// 확장 투영기 등록부(L1.persistence.spec §3.4 ProjectorRegistry, §4.5.2~§4.5.3, PS-4).
// 등록은 이름과 테이블 소유를 검사하고, 투영 버전이 저장된 값과 다르면 등록 전에 그 투영기만 다시 만든다.
// 확장 투영기가 커밋에서 던지면 커밋은 롤백되고, 그 투영기는 정지된 뒤 onFailure로 알려진다(X가 그 확장을 끈다).
// 정지한 투영기는 커밋에서 빠진 채 다시 낸 커밋이 적용하고, 다음 쓰기 열기(ensure)가 이벤트에서 다시 만든다(§4.5.2).
import { attempt, err, ok, type Logger, type Result } from "@xeon/contracts";
import type {
  Projector,
  ProjectorFailure,
  ProjectorRegisterError,
  ProjectorRegistry,
  StoreDb,
  StoreWriteError,
  Unsubscribe,
} from "@xeon/contracts/records";
import type { RowFault } from "../rows.ts";
import type { KindCatalog } from "../upcast.ts";
import { ensureProjectors } from "./rebuild.ts";

export interface ProjectorController {
  /** 밖에 내놓는 등록부 */
  readonly registry: ProjectorRegistry;
  /** 커밋이 적용하는 투영기: core가 첫째, 그 뒤 등록 순서. 다시 만들기에 실패해 뒤처진 투영기는 뺀다 */
  active(): readonly Projector[];
  /** 열 때 확인할 투영기 전부(뒤처진 것 포함) */
  all(): readonly Projector[];
  /** 투영 버전·last_seq가 어긋난 투영기를 다시 만든다. 성공하면 뒤처짐·정지 표시를 지운다 */
  ensure(): Result<readonly string[], StoreWriteError | RowFault>;
  /**
   * 확장 투영기가 던져 롤백된 커밋의 그 투영기를 정지한다. `active()`에서 빠지고 `list()`에는 남는다.
   * 정지 사유는 `session.projector_suspended`로 기록한다
   */
  suspend(name: string, message: string): void;
  /** 롤백된 커밋의 투영기 실패를 알린다 */
  notifyFailure(failure: ProjectorFailure): void;
}

export interface ProjectorControllerDeps {
  readonly db: StoreDb;
  readonly catalog: KindCatalog;
  readonly core: Projector;
  readonly logger: Logger | undefined;
}

const EXTENSION_PREFIX = "ext.";
const CAPABILITY_PREFIX = "cap.";

/** 투영기 이름이 소유하는 테이블 접두. 소유할 수 없는 이름이면 undefined */
function tablePrefixOf(name: string): string | undefined {
  if (name.startsWith(EXTENSION_PREFIX)) {
    const extension = name.slice(EXTENSION_PREFIX.length);
    return extension === "" ? undefined : `x_${extension.replaceAll("-", "_")}_`;
  }
  if (name.startsWith(CAPABILITY_PREFIX)) {
    const domain = name.slice(CAPABILITY_PREFIX.length);
    return domain === "" ? undefined : `cap_${domain.replaceAll("-", "_")}_`;
  }
  return undefined;
}

/** 접두 뒤 지역 이름은 1자 이상이고 밑줄이 없다(F.records.spec §3.4) */
function ownsTable(prefix: string, table: string): boolean {
  if (!table.startsWith(prefix)) return false;
  const local = table.slice(prefix.length);
  return /^[a-z0-9]+$/.test(local);
}

export function createProjectorController(deps: ProjectorControllerDeps): ProjectorController {
  const { db, catalog, core, logger } = deps;
  const registered: Projector[] = [];
  /** 뒤처졌거나 정지한 투영기 이름. `active()`에서 뺀다. 다음 `ensure()`가 다시 만들면 지운다 */
  const stale = new Set<string>();
  const listeners = new Set<(failure: ProjectorFailure) => void>();

  const all = (): readonly Projector[] => [core, ...registered];

  /**
   * 투영기 하나를 다시 만든다. 저장소 오류와 투영기가 재생 중 던진 것은 reason으로 바꿔 돌려준다
   * (확장 코드의 결함이 쓰기 열기를 막지 않게). core가 던지면 이 패키지의 결함이라 그대로 올린다
   */
  const rebuildOne = (projector: Projector): Result<readonly string[], string> => {
    const ran = attempt(() => ensureProjectors(db, [projector], catalog));
    if (!ran.ok) {
      if (projector === core) throw ran.error.cause;
      return err(ran.error.cause instanceof Error ? ran.error.cause.message : "projector threw");
    }
    return ran.value.ok ? ok(ran.value.value) : err(ran.value.error.kind);
  };

  const registry: ProjectorRegistry = {
    register(projector): Result<{ dispose(): void }, ProjectorRegisterError> {
      if (projector.name === core.name) return err({ kind: "name_reserved", name: projector.name });
      const prefix = tablePrefixOf(projector.name);
      if (prefix === undefined) return err({ kind: "name_reserved", name: projector.name });
      if (registered.some((other) => other.name === projector.name)) {
        return err({ kind: "name_taken", name: projector.name });
      }
      for (const table of projector.tables) {
        if (!ownsTable(prefix, table)) {
          return err({ kind: "table_not_owned", name: projector.name, table });
        }
        const owner = all().find((other) => other.tables.includes(table));
        if (owner !== undefined) return err({ kind: "table_taken", table, owner: owner.name });
      }
      // 버전이 저장된 값과 다르거나 등록하지 않은 동안 놓친 이벤트가 있으면 이 투영기만 다시 만든다
      const rebuilt = rebuildOne(projector);
      if (!rebuilt.ok) {
        // 저장소가 막혔거나 투영기가 재생 중 던졌다. 투영은 이벤트에서 다시 만들 수 있으므로 뒤처진 채 등록하고,
        // 다음 쓰기 열기(ensure)에서 다시 시도한다. 그동안 커밋은 이 투영기를 건너뛴다
        stale.add(projector.name);
        logger?.error("session.projector_rebuild_failed", {
          projector: projector.name,
          reason: rebuilt.error,
        });
      }
      registered.push(projector);
      return ok({
        dispose(): void {
          const index = registered.indexOf(projector);
          if (index >= 0) registered.splice(index, 1);
          stale.delete(projector.name);
        },
      });
    },
    list: () =>
      all().map((projector) => ({
        name: projector.name,
        version: projector.version,
        tables: projector.tables,
      })),
    onFailure(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    registry,
    all,
    active: () => all().filter((projector) => !stale.has(projector.name)),
    suspend(name, message): void {
      stale.add(name);
      logger?.error("session.projector_suspended", { projector: name, message });
    },
    ensure() {
      // core의 저장소 오류는 열기 실패로 올리고, 확장 투영기의 실패는 뒤처짐으로 두고 기록한다
      const coreDone = ensureProjectors(db, [core], catalog);
      if (!coreDone.ok) return coreDone;
      const rebuilt = [...coreDone.value];
      for (const projector of registered) {
        const done = rebuildOne(projector);
        if (done.ok) {
          stale.delete(projector.name);
          rebuilt.push(...done.value);
        } else {
          stale.add(projector.name);
          logger?.error("session.projector_rebuild_failed", {
            projector: projector.name,
            reason: done.error,
          });
        }
      }
      return ok(rebuilt);
    },
    notifyFailure(failure): void {
      for (const listener of listeners) {
        try {
          listener(failure);
        } catch (caught) {
          logger?.error("session.projector_failure_listener_threw", {
            projector: failure.projector,
            reason: caught instanceof Error ? caught.message : "unknown",
          });
        }
      }
    },
  };
}
