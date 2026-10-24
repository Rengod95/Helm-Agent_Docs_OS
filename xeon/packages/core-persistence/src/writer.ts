// 세션 테이블에 쓰는 단일 커밋 경로(L1.persistence.spec §4.1, eng.transactions.design §4.3~§4.4, TX-07).
// 테이블에 쓰는 코드는 이 파일과 projector/, lifecycle.ts의 remove(M2)뿐이다.
import {
  assertNever,
  Bug,
  canonicalJson,
  err,
  ok,
  parse,
  type Clock,
  type Result,
} from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  checkEnvelopeSize,
  COMMIT_KEY_PATTERN,
  DurableEventEnvelopeSchema,
  EffectResultSchema,
  ItemRecordedPayloadSchema,
  RECOVERY_SYNTHESIS_KINDS,
  type BlobError,
  type CommitPlan,
  type CommitRequest,
  type CommitResult,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type FaultInjector,
  type LeaseService,
  type Projector,
  type ProjectorFailure,
  type SqlTx,
  type StampedDraft,
  type StoreDb,
  type StoreError,
  type StoreWriteError,
} from "@xeon/contracts/records";
import { detachLarge, needsDetach, type PutBlob } from "./blob.ts";
import { checkpointDraftInput, completeCheckpoint, isApprovalWait } from "./checkpoint.ts";
import { insertEvent, headSeqOf } from "./events.ts";
import { sha256Hex } from "./hash.ts";
import type { GuardState, OpenSessions } from "./ownership.ts";
import { toProjectionTx } from "./projector/tx.ts";
import { PERSISTENCE_PRODUCER, producerOwnsKind, type ProducerRegistry } from "./producers.ts";
import { findRequest, insertRequest, type StoredResult } from "./requests.ts";
import { columns, type RowFault } from "./rows.ts";
import { createTxView } from "./tx-view.ts";
import type { KindCatalog } from "./upcast.ts";
import { readThread } from "./views.ts";

/** 롤백용 표지. commit 밖으로 나가지 않는다(TY-11 허용 3, eng.transactions.design §4.2 끝) */
const ROLLBACK_MARKER = new Bug("store.rollback_marker: internal marker, never escapes commit");

/** 큰 문자열 분리가 필요하다는 표지. blob 쓰기는 트랜잭션 밖이라(TX-04) 롤백하고 분리한 뒤 다시 커밋한다 */
const DETACH_MARKER = new Bug("store.detach_marker: internal marker, never escapes commit");

const COMMIT_KEY = new RegExp(COMMIT_KEY_PATTERN);

type AppendPlan = Extract<CommitPlan, { readonly kind: "append" }>;

export interface CommitHooks {
  /** build 전, 트랜잭션 안. thread id가 돌아오면 쓰기 없이 그 thread로 끝낸다(생성 멱등 키, §4.10.1) */
  readonly existingThread?: (tx: SqlTx) => Result<ThreadId | undefined, RowFault>;
  /** append가 성공한 뒤 같은 트랜잭션에서 */
  readonly afterAppend?: (tx: SqlTx) => void;
  /** 초안의 비공개 소유 확장(`events.private_owner`). 공개 초안은 null. ext.commit의 `visibility: "private"`가 쓴다 */
  readonly privateOwnerOf?: (draft: DurableEventDraft) => string | null;
}

type CommitOutcome =
  | { readonly kind: "done"; readonly result: CommitResult }
  | { readonly kind: "preempted"; readonly threadId: ThreadId };

type AttemptOutcome =
  | CommitOutcome
  /** 롤백했다. 초안의 큰 문자열을 blob으로 옮긴 뒤 같은 요청으로 다시 커밋해야 한다 */
  | { readonly kind: "needs_detach"; readonly plan: AppendPlan };

export interface SessionWriter {
  commit(request: CommitRequest): Result<CommitResult, StoreError>;
  /** 내부 확장 경로(threads.create). 같은 순서·같은 장애 주입 지점을 쓴다 */
  commitWith(request: CommitRequest, hooks: CommitHooks): Result<CommitOutcome, StoreError>;
}

export interface WriterDeps {
  readonly db: Pick<StoreDb, "write">;
  readonly leases: LeaseService;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly faults: FaultInjector;
  readonly catalog: KindCatalog;
  readonly producers: ProducerRegistry;
  readonly sessions: OpenSessions;
  readonly guard: GuardState;
  /** blob 쓰기(0단계, 큰 문자열 분리). 없으면 envelope 상한을 넘는 초안은 store.event_too_large다 */
  readonly putBlob?: PutBlob;
  /** 코어 투영기가 첫째, 그 뒤가 cap·ext 투영기(등록 순서). 커밋 7단계가 관심 kind만 적용한다 */
  readonly projectors: () => readonly Projector[];
  /** 참이면 확장·능력 투영기의 문장이 소유 테이블 밖을 건드릴 때 Bug(store.prefix_not_owned)로 거부한다(테스트·디버그 빌드) */
  readonly guardProjectors?: boolean;
  /** 확장 투영기 apply 예외로 커밋이 롤백된 뒤 알린다(롤백이 끝난 다음 부른다) */
  readonly onProjectorFailure?: (failure: ProjectorFailure) => void;
  /** 커밋이 끝난 뒤 동기 방출 */
  readonly publish: (batch: {
    readonly firstSeq: number;
    readonly lastSeq: number;
    readonly events: readonly DurableEventEnvelope[];
  }) => void;
}

interface PlannedDraft {
  readonly stamped: StampedDraft;
  readonly isCheckpoint: boolean;
}

function oversize(planned: PlannedDraft): boolean {
  return needsDetach(planned.stamped.draft);
}

function lastRecordedAt(tx: SqlTx): Result<number, RowFault> {
  const row = tx.get("SELECT recorded_at FROM events ORDER BY seq DESC LIMIT 1");
  return row === undefined ? ok(0) : columns(row, "events").int("recorded_at");
}

function currentLeaf(tx: SqlTx, threadId: string): Result<EventId | null, RowFault> {
  const thread = readThread(tx, threadId);
  return thread.ok ? ok(thread.value?.leafEventId ?? null) : thread;
}

function mapBlobError(error: BlobError): StoreError {
  switch (error.kind) {
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code: error.code };
    case "blob_missing":
    case "blob_corrupt":
      // putBlob은 읽기 쪽 오류 변형을 돌려주지 않는다. 돌려주면 포트 구현이 계약을 어긴 것이다
      throw new Bug("store.blob_put_contract: putBlob returned a read-side error variant");
    default:
      return assertNever(error, "BlobError");
  }
}

function mapWriteError(error: StoreWriteError): StoreError {
  switch (error.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "io", code: error.code };
    default:
      return assertNever(error, "StoreWriteError");
  }
}

/** core.persistence가 쓰는 합성 결과 예외의 내용 조건(L1.persistence.spec §3.9) */
function assertSynthesis(event: DurableEventEnvelope): void {
  if (event.kind === "effect.result") {
    const result = parse(EffectResultSchema, event.payload);
    if (!result.ok || !result.value.synthesized) {
      throw new Bug(
        "store.prefix_not_owned: core.persistence may only write synthesized effect.result",
      );
    }
    return;
  }
  const recorded = parse(ItemRecordedPayloadSchema, event.payload);
  if (
    !recorded.ok ||
    recorded.value.item.kind !== "toolResult" ||
    !recorded.value.item.message.isError
  ) {
    throw new Bug("store.prefix_not_owned: core.persistence may only write error toolResult items");
  }
}

export function createSessionWriter(deps: WriterDeps): SessionWriter {
  const { db, leases, clock, ids, faults, catalog, producers, sessions, guard } = deps;
  /** 분리 전 값으로 payload 검사를 마친 초안의 분리 사본(F.records.spec §3.4 규칙 5). 자리표시로 다시 검사하지 않는다 */
  const prevalidated = new WeakSet<object>();

  /**
   * 초안 하나의 envelope를 완성하고 검사한다(§4.1 5단계). seq, recordedAt, parentId는 저장소가 채운다.
   * `checkSize`가 거짓이면 크기 검사를 건너뛴다(분리 전 검사용)
   */
  const completeEnvelope = (
    leafOf: (threadId: ThreadId) => EventId | null,
    stamped: StampedDraft,
    seq: number,
    recordedAt: number,
    checkSize: boolean = true,
  ): { readonly envelope: DurableEventEnvelope; readonly upcasted: DurableEventEnvelope } => {
    const { draft, producer } = stamped;
    if (!producers.isStamped(stamped) || !producerOwnsKind(producer, draft.kind)) {
      throw new Bug(`store.prefix_not_owned: ${producer} may not write ${draft.kind}`);
    }
    const entry = catalog.entryOf(draft.kind);
    if (entry === undefined) throw new Bug(`store.kind_unregistered: ${draft.kind}`);
    if (!entry.durable) throw new Bug(`store.schema_invalid: ${draft.kind} is volatile`);
    if (draft.version > entry.version) {
      throw new Bug(
        `store.schema_invalid: ${draft.kind} v${draft.version} is newer than the catalog (v${entry.version})`,
      );
    }
    const parentId = draft.parentId !== undefined ? draft.parentId : leafOf(draft.threadId);
    const envelope: DurableEventEnvelope = { ...draft, seq, recordedAt, parentId };
    const shape = parse(DurableEventEnvelopeSchema, envelope);
    if (!shape.ok) {
      // xeon-disable-next-line xeon/bug-for-expected -- 초안은 생산자가 만든 값이고 커밋 전에 소유·스키마를 검사한다. 어긋나면 호출한 쪽의 코드 결함이다 (eng.typescript.guide TY-24)
      throw new Bug(`store.schema_invalid: ${draft.kind} envelope`, { cause: shape.error });
    }
    const upcasted = catalog.upcast(envelope);
    if (!upcasted.ok) {
      // xeon-disable-next-line xeon/bug-for-expected -- 초안은 생산자가 만든 값이고 커밋 전에 소유·스키마를 검사한다. 어긋나면 호출한 쪽의 코드 결함이다 (eng.typescript.guide TY-24)
      throw new Bug(`store.schema_invalid: cannot upcast ${draft.kind}`, { cause: upcasted.error });
    }
    if (!prevalidated.has(draft)) {
      const payload = parse(entry.payload, upcasted.value.payload);
      if (!payload.ok) {
        // xeon-disable-next-line xeon/bug-for-expected -- 초안은 생산자가 만든 값이고 커밋 전에 소유·스키마를 검사한다. 어긋나면 호출한 쪽의 코드 결함이다 (eng.typescript.guide TY-24)
        throw new Bug(`store.schema_invalid: ${draft.kind} payload`, { cause: payload.error });
      }
    }
    if (checkSize) {
      const size = checkEnvelopeSize(envelope);
      if (!size.ok) {
        // xeon-disable-next-line xeon/bug-for-expected -- 초안은 생산자가 만든 값이고 커밋 전에 소유·스키마를 검사한다. 어긋나면 호출한 쪽의 코드 결함이다 (eng.typescript.guide TY-24)
        throw new Bug(
          `store.event_too_large: ${draft.kind} is ${size.error.bytes} bytes (limit ${size.error.limit})`,
        );
      }
    }
    if (producer === PERSISTENCE_PRODUCER && RECOVERY_SYNTHESIS_KINDS.includes(draft.kind)) {
      assertSynthesis(upcasted.value);
    }
    return { envelope, upcasted: upcasted.value };
  };

  /** 적용할 투영기: core 먼저, 그 뒤 관심 kind가 맞는 투영기(등록 순서) */
  const applyProjectors = (
    tx: SqlTx,
    event: DurableEventEnvelope,
    index: number,
    requestId: string,
    failed: { failure: ProjectorFailure | null },
  ): void => {
    const [core, ...others] = deps.projectors();
    if (core === undefined) throw new Bug("store.projection_failed: no core projector");
    const run = (projector: Projector): void => {
      try {
        projector.apply(
          toProjectionTx(
            tx,
            deps.guardProjectors === true && projector !== core ? projector.tables : undefined,
          ),
          event,
        );
      } catch (caught) {
        if (projector !== core) {
          failed.failure = {
            projector: projector.name,
            event: { id: event.id, kind: event.kind, seq: event.seq },
            requestId,
            message: caught instanceof Error ? caught.message : "projector apply failed",
          };
        }
        if (caught instanceof Bug && caught.message.startsWith("store.")) throw caught;
        throw new Bug(
          `store.projection_failed: ${projector.name} on ${event.kind} (seq ${event.seq})`,
          { cause: caught },
        );
      }
    };
    run(core);
    faults.hit(`after_projection:${index}`);
    for (const projector of others) {
      if (projector.kinds === "all" || projector.kinds.includes(event.kind)) run(projector);
    }
    faults.hit(`after_ext_projection:${index}`);
  };

  /**
   * 커밋 한 번(1~12단계). `detached`가 거짓이고 초안의 envelope가 상한에 가까우면 쓰지 않고 롤백해 `needs_detach`로 알린다.
   * blob 파일 쓰기는 트랜잭션 밖에서만 하기 때문이다(TX-04)
   */
  const attemptCommit = (
    request: CommitRequest,
    hooks: CommitHooks,
    detached: boolean,
  ): Result<AttemptOutcome, StoreError> => {
    if (guard.writing || guard.notifying) {
      throw new Bug("store.nested_write: commit was called inside a commit or a commit listener");
    }
    if (!COMMIT_KEY.test(request.requestId)) {
      throw new Bug(`store.schema_invalid: commit key ${request.requestId} is not a COMMIT_KEY`);
    }
    const open = sessions.stateOf(request.threadId);
    if (open?.role === "observer") return err({ kind: "read_only", reason: "observer" });
    if (open?.role === "owner" && open.readOnly !== null) {
      return err({ kind: "read_only", reason: open.readOnly });
    }
    // 0. 트랜잭션 밖: 지문 계산
    const fingerprint = sha256Hex(canonicalJson(request.fingerprintSource));
    const threadId = request.threadId;
    let appended: readonly DurableEventEnvelope[] = [];
    const abort: { error: StoreError | null } = { error: null };
    const pending: { plan: AppendPlan | null } = { plan: null };
    const projectorFailed: { failure: ProjectorFailure | null } = { failure: null };

    const abortWith = (error: StoreError): never => {
      abort.error = error;
      throw ROLLBACK_MARKER;
    };
    /** 읽기 도우미가 손상 행을 알리면 트랜잭션을 롤백하고 commit이 row_invalid를 돌려준다(TY-24) */
    const must = <T>(read: Result<T, RowFault>): T =>
      read.ok ? read.value : abortWith(read.error);

    // 소유 확인(§4.1 2단계, §4.10.1). 요청 thread의 토큰은 build 전에 이미 새로 읽어 대조했다.
    // 새 thread의 첫 이벤트 thread.started 하나만 소유 확인에서 빠진다: 아무도 모르는 id라 다른 소유자가 있을 수 없다.
    // 같은 커밋의 다른 thread 초안(예: 부모의 agent.spawned)은 그 thread의 토큰으로 확인한다
    const verifyThreads = (tx: SqlTx, drafts: readonly PlannedDraft[]): void => {
      const targets = new Set(drafts.map((planned) => planned.stamped.draft.threadId));
      for (const target of targets) {
        const exists = must(readThread(tx, target)) !== undefined;
        const own = drafts.filter((planned) => planned.stamped.draft.threadId === target);
        if (!exists && own[0]?.stamped.draft.kind !== "thread.started") {
          abortWith({ kind: "thread_not_found", threadId: target });
        }
        const state = sessions.stateOf(target);
        if (state?.role === "observer") abortWith({ kind: "read_only", reason: "observer" });
        if (state?.role === "owner") {
          if (state.readOnly !== null) abortWith({ kind: "read_only", reason: state.readOnly });
          if (target !== threadId && !must(leases.holds(tx, state.token))) {
            abortWith({ kind: "ownership_lost", threadId: target });
          }
        } else if (exists && target !== threadId) {
          abortWith({ kind: "ownership_lost", threadId: target });
        } else if (!exists && own.length !== 1) {
          // 토큰 없이 쓸 수 있는 것은 thread.started 하나뿐이다
          abortWith({ kind: "ownership_lost", threadId: target });
        }
      }
    };

    const appendPlan = (
      tx: SqlTx,
      plan: AppendPlan,
      view: ReturnType<typeof createTxView>,
    ): CommitResult => {
      const leafOf = (target: ThreadId): EventId | null => must(currentLeaf(tx, target));
      const drafts: PlannedDraft[] = plan.drafts.map((stamped) => ({
        stamped,
        isCheckpoint: false,
      }));
      if (drafts.length === 0)
        throw new Bug("store.schema_invalid: a commit needs at least one draft");
      if (!detached && deps.putBlob !== undefined && drafts.some(oversize)) {
        // 분리 전 값으로 payload를 먼저 검사한다(F.records.spec §3.4 규칙 5). 크기는 분리 뒤에 본다
        for (const planned of drafts) {
          if (oversize(planned)) completeEnvelope(leafOf, planned.stamped, 1, 1, false);
        }
        pending.plan = plan;
        throw DETACH_MARKER;
      }
      if (plan.checkpoint !== null) {
        const stepCompleted = drafts.findLast(
          (planned) =>
            planned.stamped.draft.kind === "step.completed" &&
            planned.stamped.draft.threadId === threadId,
        );
        if (stepCompleted === undefined && !isApprovalWait(plan.checkpoint)) {
          throw new Bug(
            "store.checkpoint_without_step: checkpoint needs step.completed in the same commit",
          );
        }
        const ownDrafts = drafts.filter((planned) => planned.stamped.draft.threadId === threadId);
        const anchor = stepCompleted ?? ownDrafts[ownDrafts.length - 1];
        const leafEventId = anchor?.stamped.draft.id ?? view.leaf;
        if (leafEventId === null) {
          throw new Bug("store.checkpoint_without_step: checkpoint has no leaf to point at");
        }
        const record = completeCheckpoint(plan.checkpoint, { ids, threadId, leafEventId });
        const stamped = producers
          .internal(PERSISTENCE_PRODUCER)
          .draft(checkpointDraftInput(record, ids.next("evt"), leafEventId));
        drafts.push({ stamped, isCheckpoint: true });
      }
      verifyThreads(tx, drafts);

      let seq = must(headSeqOf(tx)) + 1;
      const firstSeq = seq;
      const recordedAt = Math.max(clock.now(), must(lastRecordedAt(tx)));
      const out: DurableEventEnvelope[] = [];
      for (const [index, planned] of drafts.entries()) {
        if (planned.isCheckpoint) faults.hit("before_checkpoint");
        const { envelope, upcasted } = completeEnvelope(leafOf, planned.stamped, seq, recordedAt);
        seq += 1;
        insertEvent(
          tx,
          envelope,
          request.requestId,
          hooks.privateOwnerOf?.(planned.stamped.draft) ?? null,
        );
        faults.hit(`after_event_insert:${index}`);
        applyProjectors(tx, upcasted, index, request.requestId, projectorFailed);
        out.push(envelope);
      }
      hooks.afterAppend?.(tx);
      const lastSeq = seq - 1;
      const leaf = must(currentLeaf(tx, threadId));
      const committed: StoredResult = {
        status: "committed",
        firstSeq,
        lastSeq,
        leaf,
        eventIds: out.map((event) => event.id),
        replayed: false,
      };
      faults.hit("before_request_insert");
      insertRequest(tx, threadId, request.requestId, fingerprint, committed);
      tx.run("UPDATE event_seq SET next_seq = ? WHERE singleton = 1", [seq]);
      for (const projector of deps.projectors()) {
        tx.run("UPDATE projector_state SET last_seq = ? WHERE name = ?", [lastSeq, projector.name]);
      }
      faults.hit("before_commit");
      appended = out;
      return committed;
    };

    const inTransaction = (tx: SqlTx): AttemptOutcome => {
      faults.hit("after_begin");
      // 2. 소유 확인(TX-10): 토큰으로 sys_leases 행을 같은 트랜잭션에서 새로 읽는다
      const threadExists = must(readThread(tx, threadId)) !== undefined;
      if (open?.role === "owner") {
        if (!must(leases.holds(tx, open.token))) abortWith({ kind: "ownership_lost", threadId });
      } else if (threadExists) {
        abortWith({ kind: "ownership_lost", threadId });
      }
      faults.hit("after_lease_check");
      const existing = must(hooks.existingThread?.(tx) ?? ok(undefined));
      if (existing !== undefined) return { kind: "preempted", threadId: existing };
      // 3. 커밋 키
      const prior = must(findRequest(tx, threadId, request.requestId));
      if (prior !== undefined) {
        if (prior.fingerprint !== fingerprint) {
          return { kind: "done", result: { status: "key_reused", requestId: request.requestId } };
        }
        return { kind: "done", result: { ...prior.result, replayed: true } };
      }
      faults.hit("after_request_check");
      // 4. expectedLeaf 비교와 build
      const view = createTxView(tx, threadId, (fault) => abortWith(fault));
      const leafConflict = request.expectedLeaf !== undefined && request.expectedLeaf !== view.leaf;
      const plan: CommitPlan = leafConflict
        ? { kind: "reject", code: "leaf_conflict", detail: null }
        : request.build(view);
      if (plan.kind === "abort") return abortWith(plan.error);
      if (plan.kind === "reject") {
        if (!threadExists && open?.role !== "owner") {
          abortWith({ kind: "thread_not_found", threadId });
        }
        const rejected: StoredResult = {
          status: "rejected",
          code: plan.code,
          detail: plan.detail,
          replayed: false,
        };
        insertRequest(tx, threadId, request.requestId, fingerprint, rejected);
        return { kind: "done", result: rejected };
      }
      return { kind: "done", result: appendPlan(tx, plan, view) };
    };

    guard.writing = true;
    let written: Result<AttemptOutcome, StoreWriteError>;
    try {
      written = db.write(inTransaction);
    } catch (caught) {
      if (caught === ROLLBACK_MARKER) {
        return err(abort.error ?? { kind: "ownership_lost", threadId });
      }
      if (caught === DETACH_MARKER && pending.plan !== null) {
        return ok({ kind: "needs_detach", plan: pending.plan });
      }
      // 확장 투영기 예외: 트랜잭션은 롤백됐다. 알린 뒤 Bug를 그대로 올린다
      if (projectorFailed.failure !== null) deps.onProjectorFailure?.(projectorFailed.failure);
      throw caught;
    } finally {
      guard.writing = false;
    }
    if (!written.ok) return err(mapWriteError(written.error));
    faults.hit("after_commit");
    const outcome = written.value;
    if (outcome.kind === "done" && outcome.result.status === "committed" && appended.length > 0) {
      const first = appended[0];
      const last = appended[appended.length - 1];
      if (first !== undefined && last !== undefined) {
        deps.publish({ firstSeq: first.seq, lastSeq: last.seq, events: appended });
      }
    }
    return ok(outcome);
  };

  /** 커밋. 큰 문자열이 있으면 blob으로 옮기고(0단계) 같은 요청을 한 번 더 커밋한다 */
  const runCommit = (
    request: CommitRequest,
    hooks: CommitHooks,
  ): Result<CommitOutcome, StoreError> => {
    const first = attemptCommit(request, hooks, false);
    if (!first.ok) return first;
    const outcome = first.value;
    if (outcome.kind !== "needs_detach") return ok(outcome);
    const putBlob = deps.putBlob;
    if (putBlob === undefined) throw new Bug("store.blob_unavailable: detach needs putBlob");
    const drafts: StampedDraft[] = [];
    for (const stamped of outcome.plan.drafts) {
      if (!needsDetach(stamped.draft)) {
        drafts.push(stamped);
        continue;
      }
      const moved = detachLarge(stamped.draft, putBlob);
      if (!moved.ok) return err(mapBlobError(moved.error));
      const restamped = producers.restamp(stamped, moved.value);
      prevalidated.add(restamped.draft);
      drafts.push(restamped);
    }
    // 분리한 초안으로 같은 요청(같은 키, 같은 지문)을 다시 낸다. build는 첫 시도에서 한 번 불렸고 결과를 그대로 쓴다
    const second = attemptCommit(
      { ...request, build: () => ({ ...outcome.plan, drafts }) },
      hooks,
      true,
    );
    if (!second.ok) return second;
    if (second.value.kind === "needs_detach") {
      throw new Bug("store.event_too_large: draft is still too large after detaching");
    }
    return ok(second.value);
  };

  return {
    commit(request: CommitRequest): Result<CommitResult, StoreError> {
      const outcome = runCommit(request, {});
      if (!outcome.ok) return outcome;
      if (outcome.value.kind === "preempted") {
        throw new Bug("store.nested_write: commit hooks are internal");
      }
      return ok(outcome.value.result);
    },
    commitWith: runCommit,
  };
}
