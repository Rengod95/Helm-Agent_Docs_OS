// 수명주기 API(L1.persistence.spec §3.8, PS-9·PS-10). create는 여기, 조회·종결·삭제·제목은 lifecycle-admin.ts,
// 분기(moveLeaf, revert, fork, prepareSwitch)는 lifecycle-branch.ts다.
import { assertNever, Bug, detach, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  CommitPlan,
  LeaseError,
  LeaseHolder,
  LeaseService,
  LeaseToken,
  LifecycleError,
  StoreDb,
  ThreadCreateInput,
  ThreadCreated,
  ThreadLifecycle,
} from "@xeon/contracts/records";
import { insertCreationKey, lookupCreationKey } from "./creation-keys.ts";
import { sessionResource } from "./ids.ts";
import { createAdminOps } from "./lifecycle-admin.ts";
import { createBranchOps } from "./lifecycle-branch.ts";
import type { GuardState, OpenSessions } from "./ownership.ts";
import type { SessionPoints } from "./points.ts";
import { PERSISTENCE_PRODUCER, type ProducerRegistry } from "./producers.ts";
import { readResult } from "./rows.ts";
import { readThread } from "./views.ts";
import type { CommitHooks, SessionWriter } from "./writer.ts";

export interface LifecycleDeps {
  readonly db: StoreDb;
  readonly leases: LeaseService;
  readonly writer: SessionWriter;
  readonly producers: ProducerRegistry;
  readonly sessions: OpenSessions;
  readonly ids: IdFactory;
  readonly holder: LeaseHolder | undefined;
  readonly onLeaseLost: ((threadId: ThreadId) => void) | undefined;
  readonly guard: GuardState;
  readonly points: SessionPoints;
  readonly logger: Logger | undefined;
  /** thread 행을 지울 투영 테이블 이름(등록된 모든 투영기) */
  readonly projectorTables: () => readonly string[];
  /** 삭제된 thread의 메모리 캐시를 버린다 */
  readonly onRemoved: (threadId: ThreadId) => void;
}

const CREATION_KEY_MAX = 200;

function leaseFailure(error: LeaseError, threadId: ThreadId): LifecycleError {
  switch (error.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "lock_io":
      return { kind: "io", code: error.code };
    case "row_invalid":
      return error;
    case "lock_busy":
    case "lease_lost":
      // 새로 만든 id의 임대를 다른 소유자가 쥐고 있다. 소유권을 잃은 것과 같다
      return { kind: "ownership_lost", threadId };
    default:
      return assertNever(error, "LeaseError");
  }
}

export function createLifecycle(deps: LifecycleDeps): ThreadLifecycle {
  const { db, leases, writer, producers, sessions, ids } = deps;

  const created = (
    threadId: ThreadId,
    replayed: boolean,
    token: LeaseToken | null,
  ): Result<ThreadCreated, LifecycleError> => {
    const read = readResult(db, (tx) => readThread(tx, threadId));
    if (!read.ok) return read;
    // 생성 키로 찾은 thread가 그 사이 지워졌을 수 있다(경합)
    if (read.value === undefined) return err({ kind: "thread_not_found", threadId });
    return ok({ threadId, headSeq: read.value.headSeq, replayed, token });
  };

  type ForkedFrom = { readonly threadId: ThreadId; readonly eventId: EventId };

  /** thread.started 커밋과 (자식 thread면) 임대 획득. forkedFrom이 있으면 fork가 부른 것이다 */
  const createThread = (
    input: ThreadCreateInput,
    forkedFrom: ForkedFrom | undefined,
  ): Result<ThreadCreated, LifecycleError> => {
    const { threadId, creationKey } = input;
    if (
      creationKey !== undefined &&
      (creationKey.length < 1 || creationKey.length > CREATION_KEY_MAX)
    ) {
      throw new Bug("store.schema_invalid: creationKey must be 1..200 characters");
    }
    // 이미 쓴 생성 키면 임대도 얻지 않고 처음 thread를 돌려준다. 트랜잭션 안에서 한 번 더 본다(경합)
    if (creationKey !== undefined) {
      const found = readResult(db, (tx) => lookupCreationKey(tx, creationKey));
      if (!found.ok) return err(found.error);
      if (found.value !== undefined) return created(found.value, true, null);
    }
    let token: LeaseToken | null = null;
    if (input.inheritOwnerFrom !== undefined) {
      const { holder } = deps;
      if (holder === undefined) {
        throw new Bug(
          "store.lease_failed: inheritOwnerFrom needs the engine LeaseHolder (SessionDeps.holder)",
        );
      }
      if (holder.holderId !== input.inheritOwnerFrom.holderId) {
        throw new Bug("store.lease_failed: inheritOwnerFrom belongs to a different holder");
      }
      const acquired = leases.acquire(sessionResource(threadId), holder);
      if (!acquired.ok) return err(leaseFailure(acquired.error, threadId));
      token = acquired.value;
    }
    const giveBackLease = (): void => {
      if (token !== null) leases.release(token);
    };
    const handle = producers.internal(PERSISTENCE_PRODUCER);
    const hooks: CommitHooks =
      creationKey === undefined
        ? {}
        : {
            existingThread: (tx) => lookupCreationKey(tx, creationKey),
            afterAppend: (tx) => {
              insertCreationKey(tx, creationKey, threadId);
            },
          };
    let outcome: ReturnType<SessionWriter["commitWith"]>;
    try {
      outcome = writer.commitWith(
        {
          threadId,
          requestId: `thread:${threadId}:start`,
          // workspace는 있을 때만 지문에 넣는다: 필드가 없던 때의 같은 키 재시도가 key_reused가 되지 않게 한다
          fingerprintSource: {
            title: input.title ?? null,
            creationKey: creationKey ?? null,
            ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
            ...(forkedFrom === undefined ? {} : { forkedFrom: forkedFrom.eventId }),
          },
          build(view): CommitPlan {
            if (view.threadStatus !== "absent") {
              throw new Bug(`store.schema_invalid: thread ${threadId} already exists`);
            }
            return {
              kind: "append",
              drafts: [
                handle.draft({
                  id: ids.next("evt"),
                  kind: "thread.started",
                  threadId,
                  turnId: null,
                  stepId: null,
                  causationId: null,
                  correlationId: null,
                  // fork의 첫 이벤트는 출처 이벤트에 이어 붙는다. 활성 가지(parent_id 사슬)가 출처 thread의 fork 지점까지의 기록을
                  // 그대로 지나므로 컨텍스트 조립과 `thread.read`가 원본 item을 복사 없이 잇는다(M2 마감 G2-11, F.wire-settings.spec §3.4.6 3.1)
                  ...(forkedFrom === undefined ? {} : { parentId: forkedFrom.eventId }),
                  payload: {
                    title: input.title ?? null,
                    forkedFrom: forkedFrom ?? null,
                    ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
                  },
                }),
              ],
              checkpoint: null,
            };
          },
        },
        hooks,
      );
    } catch (caught) {
      // 커밋 전 Bug(스키마 위반 등)로 끝나도 얻은 임대를 남기지 않는다
      giveBackLease();
      throw caught;
    }
    if (!outcome.ok) {
      giveBackLease();
      return err(outcome.error);
    }
    const value = outcome.value;
    if (value.kind === "preempted") {
      giveBackLease();
      return created(value.threadId, true, null);
    }
    const { result } = value;
    if (result.status !== "committed") {
      giveBackLease();
      throw new Bug(`store.schema_invalid: thread.started was ${result.status}`);
    }
    if (token !== null) {
      const owned = token;
      const prior = sessions.stateOf(threadId);
      if (prior?.role === "owner") prior.keepAlive?.[Symbol.dispose]();
      const keepAlive = leases.keepAlive(owned, () => {
        sessions.forget(threadId);
        deps.onLeaseLost?.(threadId);
      });
      sessions.set(threadId, {
        role: "owner",
        token: owned,
        readOnly: null,
        selfAcquired: true,
        keepAlive,
      });
    }
    if (forkedFrom === undefined && !result.replayed) {
      detach(
        deps.points.start(
          { reason: "new", threadId },
          `${threadId}:session_start:${String(result.lastSeq)}`,
        ),
        (cause) => {
          deps.logger?.warn("session.point_failed", {
            point: "session_start",
            threadId,
            reason: String(cause),
          });
        },
      );
    }
    return ok({ threadId, headSeq: result.lastSeq, replayed: result.replayed, token });
  };

  return {
    create: (input) => createThread(input, undefined),
    ...createAdminOps({
      db,
      leases,
      writer,
      producers,
      sessions,
      guard: deps.guard,
      ids,
      points: deps.points,
      logger: deps.logger,
      projectorTables: deps.projectorTables,
      onRemoved: deps.onRemoved,
    }),
    ...createBranchOps({
      db,
      writer,
      producers,
      sessions,
      ids,
      points: deps.points,
      logger: deps.logger,
      createForked: (input, forkedFrom) => createThread(input, forkedFrom),
    }),
  };
}
