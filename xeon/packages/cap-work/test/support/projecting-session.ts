// 확장 투영기 등록부(core-persistence PS-4)는 m2/l1b 트랙이 구현한다. 통합 전까지 이 대역이 같은 약속을 지킨다:
// register가 DDL을 적용하고, 커밋된 이벤트마다 등록된 투영기의 apply를 부른다. 실제 구현은 같은 커밋 트랜잭션 안에서
// 부르지만 이 대역은 커밋 직후 별도 트랜잭션에서 부른다. 원자성은 core-persistence 쪽 시험의 몫이다.
// 통합 때 이 파일을 지우고 harness가 실제 `session.projectors`를 쓴다.
import { Bug, ok } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  CommitListener,
  DurableEventEnvelope,
  FeedFilter,
  Projector,
  ProjectorRegistry,
  SessionService,
  SqlTx,
  StoreDb,
} from "@xeon/contracts/records";

export interface ProjectingSession {
  readonly session: SessionService;
  /**
   * 세션 범위 설정 변경(`settings.changed`)을 투영기에 알린다. 이 이벤트를 쓰는 core.persistence의 session-settings(PS-14)는
   * m2/l1b가 구현한다. 통합 전까지 현재 마지막 seq에 붙은 이벤트로 흉내 내고(로그에는 없다), rebuild가 같은 자리에 다시 넣는다
   */
  recordSetting(threadId: ThreadId, payload: unknown): void;
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

function matches(event: DurableEventEnvelope, filter: FeedFilter | undefined): boolean {
  if (filter === undefined) return true;
  const threadOk = filter.threadIds === undefined || filter.threadIds.includes(event.threadId);
  const kindOk =
    filter.kindPrefixes === undefined ||
    filter.kindPrefixes.some((prefix) => event.kind.startsWith(prefix));
  return threadOk && kindOk;
}

export function withProjection(
  real: SessionService,
  db: StoreDb,
  ids: IdFactory,
  now: () => number,
): ProjectingSession {
  const synthetic: DurableEventEnvelope[] = [];
  const projectors: Projector[] = [];
  const subscribers: {
    readonly listener: CommitListener;
    readonly filter: FeedFilter | undefined;
  }[] = [];
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
    // 실제 구현은 같은 트랜잭션의 투영 뒤에 알린다. 이 대역은 투영을 마친 뒤 직접 알려 같은 순서를 지킨다
    subscribe(_afterSeq, listener, filter) {
      const entry = { listener, filter };
      subscribers.push(entry);
      return ok(() => {
        subscribers.splice(subscribers.indexOf(entry), 1);
      });
    },
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
        for (const { listener, filter } of subscribers.slice()) {
          const events = read.value.events.filter((event) => matches(event, filter));
          if (events.length > 0) {
            listener({ firstSeq: result.value.firstSeq, lastSeq: result.value.lastSeq, events });
          }
        }
      }
      return result;
    },
  };
  return {
    session,
    recordSetting(threadId, payload) {
      const head = real.feed.headSeq();
      if (!head.ok) throw new Bug("fake registry: cannot read the head seq");
      const event: DurableEventEnvelope = {
        id: ids.next("evt"),
        kind: "settings.changed",
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        recordedAt: now(),
        causationId: null,
        correlationId: null,
        payload,
        durable: true,
        seq: head.value,
        parentId: null,
      };
      synthetic.push(event);
      const applied = db.write((tx) => {
        applyAll(tx, projectors, [event]);
      });
      if (!applied.ok) throw new Bug("fake registry: projection failed", { cause: applied.error });
    },
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
        // 같은 seq에서는 로그의 이벤트가 먼저, 대역 이벤트가 나중이다
        const ordered = [...events, ...synthetic].toSorted((a, b) => a.seq - b.seq);
        applyAll(tx, projectors, ordered);
      });
      if (!rebuilt.ok) throw new Bug("fake registry: rebuild failed", { cause: rebuilt.error });
    },
  };
}
