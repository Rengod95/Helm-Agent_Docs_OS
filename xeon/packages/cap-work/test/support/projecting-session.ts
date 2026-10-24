// 확장 투영기 등록부(core-persistence PS-4)는 m2/l1b 트랙이 구현한다. 통합 전까지 이 대역이 같은 약속을 지킨다:
// register가 DDL을 적용하고, 커밋된 이벤트마다 등록된 투영기의 apply를 부른다. 실제 구현은 같은 커밋 트랜잭션 안에서
// 부르지만 이 대역은 커밋 직후 별도 트랜잭션에서 부른다. 원자성은 core-persistence 쪽 시험의 몫이다.
// 통합 때 이 파일을 지우고 harness가 실제 `session.projectors`를 쓴다.
import { Bug, ok } from "@xeon/contracts";
import type {
  DurableEventEnvelope,
  Projector,
  ProjectorRegistry,
  SessionService,
  SqlTx,
  StoreDb,
} from "@xeon/contracts/records";

export interface ProjectingSession {
  readonly session: SessionService;
  /** 등록된 투영기의 테이블을 지우고 이벤트 전체를 다시 재생한다 */
  rebuild(): Promise<void>;
}

function applyAll(
  tx: SqlTx,
  projectors: readonly Projector[],
  events: readonly DurableEventEnvelope[],
) {
  for (const event of events) {
    for (const projector of projectors) {
      if (projector.kinds === "all" || projector.kinds.includes(event.kind)) {
        projector.apply(tx, event);
      }
    }
  }
}

export function withProjection(real: SessionService, db: StoreDb): ProjectingSession {
  const projectors: Projector[] = [];
  const registry: ProjectorRegistry = {
    register(projector) {
      const written = db.write((tx) => {
        for (const statement of projector.ddl) tx.run(statement);
      });
      if (!written.ok) throw new Bug("fake registry: DDL failed", { cause: written.error });
      projectors.push(projector);
      return ok({
        dispose() {
          projectors.splice(projectors.indexOf(projector), 1);
        },
      });
    },
    list: () => projectors.map(({ name, version, tables }) => ({ name, version, tables })),
    onFailure: () => () => {},
  };
  const session: SessionService = {
    ...real,
    projectors: registry,
    commit(request) {
      const result = real.commit(request);
      if (result.ok && result.value.status === "committed" && !result.value.replayed) {
        const read = real.feed.read(
          result.value.firstSeq - 1,
          result.value.lastSeq,
          undefined,
          result.value.lastSeq - result.value.firstSeq + 1,
          result.value.lastSeq - result.value.firstSeq + 1,
        );
        if (!read.ok) throw new Bug("fake registry: cannot read the committed events");
        const applied = db.write((tx) => {
          applyAll(tx, projectors, read.value.events);
        });
        if (!applied.ok)
          throw new Bug("fake registry: projection failed", { cause: applied.error });
      }
      return result;
    },
  };
  return {
    session,
    async rebuild() {
      const events: DurableEventEnvelope[] = [];
      for await (const item of real.readFrom(0)) {
        if (!item.ok) throw new Bug("fake registry: cannot read events", { cause: item.error });
        events.push(item.value);
      }
      const rebuilt = db.write((tx) => {
        for (const projector of projectors) {
          for (const table of projector.tables) tx.run(`DELETE FROM ${table}`);
        }
        applyAll(tx, projectors, events);
      });
      if (!rebuilt.ok) throw new Bug("fake registry: rebuild failed", { cause: rebuilt.error });
    },
  };
}
