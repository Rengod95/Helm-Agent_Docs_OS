// F 인터페이스(ProjectorRegistryPort, ScopedStorePort)로 만든 세션 저장 대역. 이벤트 로그, 투영기 실행,
// 트랜잭션 롤백, 장애 주입 지점(L0.store와 같은 문자열)을 갖는다(X.operations.plan O-15).
import { err, ok, Bug } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  ProjectionTx,
  Projector,
  ProjectorFailure,
  ProjectorRegisterError,
  ProjectorRegistry,
  SqlTx,
  StoreDb,
} from "@xeon/contracts/records";
import { extTablePrefix } from "@xeon/contracts/records";
import { fixedIdFactory } from "../../../src/testing/index.ts";
import { createFakeSql, type FakeSql } from "./sql.ts";

type FaultPoint = "after_ext_projection:0";

export interface FakeSession {
  readonly registry: Pick<ProjectorRegistry, "register" | "onFailure">;
  readonly store: { scoped(owner: string): StoreDb };
  readonly sql: FakeSql;
  /** 이벤트 하나를 커밋한다. 투영기를 같은 트랜잭션에서 실행하고, 장애 지점이나 apply 예외면 되돌린다 */
  commit(
    events: readonly DurableEventEnvelope[],
    options?: { readonly fault?: FaultPoint },
  ): { readonly committed: boolean; readonly error?: unknown };
  readonly log: readonly DurableEventEnvelope[];
  /** 등록된 투영기 이름 */
  projectors(): readonly string[];
  /** 테이블 행 해시. 롤백을 확인한다 */
  hashOf(table: string): string;
}

const ids = fixedIdFactory(9000);
let sequence = 0;

export function envelope(
  threadId: ThreadId,
  kind: DurableEventEnvelope["kind"],
  payload: unknown,
): DurableEventEnvelope {
  sequence += 1;
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: 1_767_571_200_000,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq: sequence,
    parentId: null,
  };
}

function ownsTable(projector: Projector, statement: string): boolean {
  const names = [...statement.matchAll(/"((?:x|xh)_[a-z0-9_]*)"/g)].map((match) => match[1]);
  return names.every(
    (name) => name === undefined || projector.tables.includes(name) || name.includes("__i"),
  );
}

function ownerPrefix(owner: string): string {
  if (owner === "xh") return "xh_";
  if (owner.startsWith("ext.")) return extTablePrefix(owner.slice("ext.".length));
  throw new Bug(`store.prefix_not_owned: unknown owner ${owner}`);
}

export function createFakeSession(): FakeSession {
  const sql = createFakeSql();
  const projectors = new Map<string, Projector>();
  const versions = new Map<string, number>();
  const listeners = new Set<(failure: ProjectorFailure) => void>();
  const log: DurableEventEnvelope[] = [];

  function txFor(projector: Projector): ProjectionTx {
    const guard = (statement: string): void => {
      if (!ownsTable(projector, statement)) {
        throw new Bug(`store.prefix_not_owned: ${statement}`);
      }
    };
    return {
      run: (statement, params) => {
        guard(statement);
        sql.run(statement, params);
      },
      get: (statement, params) => {
        guard(statement);
        return sql.get(statement, params);
      },
      all: (statement, params) => {
        guard(statement);
        return sql.all(statement, params);
      },
    };
  }

  const current: { projector: Projector | undefined; event: DurableEventEnvelope | undefined } = {
    projector: undefined,
    event: undefined,
  };

  function apply(projector: Projector, event: DurableEventEnvelope): void {
    if (projector.kinds === "all" || projector.kinds.includes(event.kind)) {
      current.projector = projector;
      current.event = event;
      projector.apply(txFor(projector), event);
      current.projector = undefined;
      current.event = undefined;
    }
  }

  const registry: FakeSession["registry"] = {
    register(projector) {
      if (projectors.has(projector.name)) {
        const error: ProjectorRegisterError = { kind: "name_taken", name: projector.name };
        return err(error);
      }
      const prefix = projector.name.startsWith("ext.")
        ? extTablePrefix(projector.name.slice("ext.".length))
        : "";
      for (const table of projector.tables) {
        if (!table.startsWith(prefix)) {
          return err({ kind: "table_not_owned", name: projector.name, table });
        }
      }
      for (const statement of projector.ddl) sql.run(statement);
      const previous = versions.get(projector.name);
      versions.set(projector.name, projector.version);
      if (previous !== undefined && previous !== projector.version) {
        // 투영 버전이 올랐다: 그 투영기의 테이블을 비우고 이벤트 전체를 재생해 다시 만든다
        const snapshot = sql.snapshot();
        for (const table of projector.tables) sql.run(`DELETE FROM "${table}"`);
        try {
          for (const event of log) apply(projector, event);
        } catch (error) {
          sql.restore(snapshot);
          throw error;
        }
      }
      projectors.set(projector.name, projector);
      return ok({
        dispose: () => {
          if (projectors.get(projector.name) === projector) projectors.delete(projector.name);
        },
      });
    },
    onFailure(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const store: FakeSession["store"] = {
    scoped(owner) {
      const prefix = ownerPrefix(owner);
      const guard = (statement: string): void => {
        const names = [
          ...statement.matchAll(/(?:FROM|INTO|UPDATE|TABLE(?: IF NOT EXISTS)?) "([^"]+)"/g),
        ];
        for (const match of names) {
          if (match[1] !== undefined && !match[1].startsWith(prefix)) {
            throw new Bug(`store.prefix_not_owned: ${owner} cannot touch ${match[1]}`);
          }
        }
      };
      const tx: SqlTx = {
        run: (statement, params) => {
          guard(statement);
          return sql.run(statement, params);
        },
        get: (statement, params) => {
          guard(statement);
          return sql.get(statement, params);
        },
        all: (statement, params) => {
          guard(statement);
          return sql.all(statement, params);
        },
      };
      return {
        write(fn) {
          const snapshot = sql.snapshot();
          try {
            return ok(fn(tx));
          } catch (error) {
            sql.restore(snapshot);
            throw error;
          }
        },
        read: (fn) => ok(fn(tx)),
      };
    },
  };

  return {
    registry,
    store,
    sql,
    log,
    projectors: () => [...projectors.keys()],
    hashOf: (table) => JSON.stringify(sql.rowsOf(table)),
    commit(events, options) {
      const snapshot = sql.snapshot();
      try {
        for (const event of events) {
          for (const projector of projectors.values()) apply(projector, event);
        }
        if (options?.fault === "after_ext_projection:0") {
          throw new Error("injected fault after_ext_projection:0");
        }
        log.push(...events);
        return { committed: true };
      } catch (error) {
        sql.restore(snapshot);
        const { projector, event } = current;
        current.projector = undefined;
        current.event = undefined;
        if (projector !== undefined && event !== undefined) {
          // 투영기 apply 예외: 커밋은 롤백되고 등록자에게 알린다(L1.persistence.spec §3.4 onFailure)
          const failure: ProjectorFailure = {
            projector: projector.name,
            event: { id: event.id, kind: event.kind, seq: event.seq },
            requestId: "fake-commit",
            message: error instanceof Error ? error.message : "projector failed",
          };
          for (const listener of listeners) listener(failure);
        }
        return { committed: false, error };
      }
    },
  };
}
