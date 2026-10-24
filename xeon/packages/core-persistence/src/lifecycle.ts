// 수명주기 API(L1.persistence.spec §3.8). M1은 create만 구현한다(PS-9). 나머지는 M2다.
import { assertNever, Bug, err, ok, type Result } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
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
  ThreadPage,
} from "@xeon/contracts/records";
import { insertCreationKey, lookupCreationKey } from "./creation-keys.ts";
import { sessionResource } from "./ids.ts";
import type { OpenSessions } from "./ownership.ts";
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
}

const CREATION_KEY_MAX = 200;

function notYet(member: string): never {
  throw new Bug(`session.not_implemented: threads.${member} arrives with M2 (PS-9, PS-10, PS-18)`);
}

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

  return {
    create(input: ThreadCreateInput): Result<ThreadCreated, LifecycleError> {
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
                    payload: {
                      title: input.title ?? null,
                      forkedFrom: null,
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
      return ok({ threadId, headSeq: result.lastSeq, replayed: result.replayed, token });
    },
    list: (): ThreadPage => notYet("list"),
    close: (): Result<void, LifecycleError> => notYet("close"),
    remove: (): Result<void, LifecycleError> => notYet("remove"),
    fork: () =>
      Promise.reject(new Bug("session.not_implemented: threads.fork arrives with M2 (PS-9)")),
    revert: () =>
      Promise.reject(new Bug("session.not_implemented: threads.revert arrives with M2 (PS-9)")),
    moveLeaf: () =>
      Promise.reject(new Bug("session.not_implemented: threads.moveLeaf arrives with M2 (PS-10)")),
    setTitle: (): Result<void, LifecycleError> => notYet("setTitle"),
    prepareSwitch: () =>
      Promise.reject(
        new Bug("session.not_implemented: threads.prepareSwitch arrives with M2 (PS-17)"),
      ),
  };
}
