// 수명주기 가운데 분기 쪽(L1.persistence.spec §4.10.2~§4.10.4, PS-9·PS-10): moveLeaf, revert, fork, prepareSwitch.
// first 지점(session_before_*)은 커밋 전, 트랜잭션 밖에서 await하고 거부면 아무것도 커밋하지 않는다.
import { assertNever, detach, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ItemId, ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  type BranchSummaryInput,
  type CommitPlan,
  type CommitResult,
  type LifecycleError,
  type SqlTx,
  type StoreDb,
  type StoreError,
  type ThreadCreateInput,
  type ThreadCreated,
  type ThreadLifecycle,
} from "@xeon/contracts/records";
import {
  commonAncestor,
  countBranchItemsAfter,
  isOnBranch,
  itemEvent,
  type BranchEventRef,
} from "./branch.ts";
import { sha256Hex } from "./hash.ts";
import { ownerError } from "./lifecycle-admin.ts";
import type { OpenSessions } from "./ownership.ts";
import type { SessionPoints } from "./points.ts";
import { PERSISTENCE_PRODUCER, type ProducerRegistry } from "./producers.ts";
import { columns, readResult, rowInvalid, type RowFault } from "./rows.ts";
import { readThread, type ThreadRow } from "./views.ts";
import type { SessionWriter } from "./writer.ts";

export interface BranchDeps {
  readonly db: StoreDb;
  readonly writer: SessionWriter;
  readonly producers: ProducerRegistry;
  readonly sessions: OpenSessions;
  readonly ids: IdFactory;
  readonly points: SessionPoints;
  readonly logger: Logger | undefined;
  /** fork의 새 thread를 만든다(thread.started{forkedFrom}) */
  readonly createForked: (
    input: ThreadCreateInput,
    forkedFrom: { readonly threadId: ThreadId; readonly eventId: EventId },
  ) => Result<ThreadCreated, LifecycleError>;
}

type TreeOps = Pick<ThreadLifecycle, "revert" | "moveLeaf" | "fork" | "prepareSwitch">;

interface ItemFacts {
  readonly kind: string;
  readonly stopReason: string | null;
  readonly turnId: string | null;
  readonly seq: number;
}

function itemFacts(
  tx: SqlTx,
  threadId: ThreadId,
  eventId: EventId,
): Result<ItemFacts | undefined, RowFault> {
  const row = tx.get(
    "SELECT kind, stop_reason, turn_id, seq FROM p_items WHERE thread_id = ? AND event_id = ?",
    [threadId, eventId],
  );
  if (row === undefined) return ok(undefined);
  const c = columns(row, "p_items");
  const kind = c.string("kind");
  if (!kind.ok) return kind;
  const stopReason = c.nullableString("stop_reason");
  if (!stopReason.ok) return stopReason;
  const turnId = c.nullableString("turn_id");
  if (!turnId.ok) return turnId;
  const seq = c.int("seq");
  if (!seq.ok) return seq;
  return ok({
    kind: kind.value,
    stopReason: stopReason.value,
    turnId: turnId.value,
    seq: seq.value,
  });
}

/** 같은 turn에서 이 item 뒤에 활성 가지 item이 더 있는가 */
function hasLaterItemInTurn(
  tx: SqlTx,
  leaf: EventId,
  turnId: string,
  afterSeq: number,
): Result<boolean, RowFault> {
  const row = tx.get(
    `WITH RECURSIVE chain(id) AS (
       SELECT id FROM events WHERE id = ?
       UNION ALL
       SELECT e.parent_id FROM chain c JOIN events e ON e.id = c.id WHERE e.parent_id IS NOT NULL
     )
     SELECT 1 AS hit FROM chain c JOIN p_items i ON i.event_id = c.id
     WHERE i.turn_id = ? AND i.seq > ? LIMIT 1`,
    [leaf, turnId, afterSeq],
  );
  return ok(row !== undefined);
}

function eventBelongsToThread(
  tx: SqlTx,
  threadId: ThreadId,
  eventId: EventId,
): Result<{ readonly seq: number } | undefined, RowFault> {
  const row = tx.get("SELECT seq FROM events WHERE id = ? AND thread_id = ?", [eventId, threadId]);
  if (row === undefined) return ok(undefined);
  const seq = columns(row, "events").int("seq");
  return seq.ok ? ok({ seq: seq.value }) : seq;
}

function cancelled(
  point: "session.fork.before" | "session.tree.before" | "session.switch.before",
  decision: { readonly cancel: boolean; readonly reason?: string } | undefined,
): LifecycleError | null {
  if (decision === undefined || !decision.cancel) return null;
  return { kind: "cancelled_by_extension", point, reason: decision.reason ?? null };
}

export function createBranchOps(deps: BranchDeps): TreeOps {
  const { db, writer, producers, sessions, ids, points, logger } = deps;
  const handle = producers.internal(PERSISTENCE_PRODUCER);

  const failPoint =
    (point: string, threadId: ThreadId) =>
    (cause: unknown): void => {
      logger?.warn("session.point_failed", { point, threadId, reason: String(cause) });
    };

  /** thread 행. 없으면 thread_not_found, 닫혔으면 thread_closed, 열린 turn이 있으면 turn_running */
  const requireIdle = (threadId: ThreadId): Result<ThreadRow, LifecycleError> => {
    const read = readResult(db, (tx) => readThread(tx, threadId));
    if (!read.ok) return err(read.error);
    const thread = read.value;
    if (thread === undefined) return err({ kind: "thread_not_found", threadId });
    if (thread.status === "closed") return err({ kind: "thread_closed", threadId });
    if (thread.openTurnId !== null) return err({ kind: "turn_running", turnId: thread.openTurnId });
    return ok(thread);
  };

  /** 지점 payload에 싣는 공통 조상과 요약 대상 수 */
  const treeFacts = (
    oldLeaf: EventId | null,
    target: EventId,
  ): Result<{ readonly ancestor: EventId | null; readonly entries: number }, StoreError> =>
    readResult(db, (tx) => {
      if (oldLeaf === null) return ok({ ancestor: null, entries: 0 });
      const common = commonAncestor(tx, oldLeaf, target);
      if (!common.ok) return common;
      const entries = countBranchItemsAfter(tx, oldLeaf, common.value?.seq ?? 0);
      if (!entries.ok) return entries;
      return ok({ ancestor: common.value?.id ?? null, entries: entries.value });
    });

  /** leaf를 target으로 옮기는 커밋(+요약). moveLeaf와 revert가 같이 쓴다 */
  const commitLeafMove = (args: {
    readonly threadId: ThreadId;
    readonly target: EventId;
    readonly reason: "branch" | "rewind" | "restore";
    /** 호출자가 넘긴 키 원문. 커밋 키는 `keyPrefix` + `commitKeyPart(requestKey)`다(U-13) */
    readonly requestKey: string;
    readonly keyPrefix: "leaf" | "revert";
    readonly summary: BranchSummaryInput | undefined;
    readonly fingerprintSummary: string | null;
  }): Result<
    {
      readonly result: Extract<CommitResult, { status: "committed" }>;
      readonly oldLeaf: EventId | null;
    },
    LifecycleError
  > => {
    const { threadId, target, reason, summary } = args;
    let oldLeaf: EventId | null = null;
    const committed = writer.commit({
      threadId,
      requestId: `${args.keyPrefix}:${commitKeyPart(args.requestKey, sha256Hex)}`,
      fingerprintSource: { target, reason, summary: args.fingerprintSummary },
      build(view): CommitPlan {
        if (view.threadStatus === "closed") {
          return { kind: "reject", code: "thread_closed", detail: null };
        }
        if (view.threadStatus === "running") {
          return { kind: "reject", code: "turn_running", detail: null };
        }
        oldLeaf = view.leaf;
        const drafts = [
          handle.draft({
            id: ids.next("evt"),
            kind: "thread.leaf_moved",
            threadId,
            turnId: null,
            stepId: null,
            causationId: null,
            correlationId: null,
            payload: { leafEventId: target, reason },
          }),
        ];
        if (summary !== undefined && view.leaf !== null) {
          drafts.push(
            handle.draft({
              id: ids.next("evt"),
              kind: "thread.branch_summarized",
              threadId,
              turnId: null,
              stepId: null,
              causationId: null,
              correlationId: null,
              payload: {
                fromEventId: view.leaf,
                summary: summary.summary,
                details: summary.details,
                usage: summary.usage,
              },
            }),
          );
        }
        return { kind: "append", drafts, checkpoint: null };
      },
    });
    if (!committed.ok) return err(committed.error);
    const result = committed.value;
    switch (result.status) {
      case "committed":
        return ok({ result, oldLeaf });
      case "rejected":
        if (result.code === "turn_running") {
          const thread = readResult(db, (tx) => readThread(tx, threadId));
          if (!thread.ok) return err(thread.error);
          const turnId = thread.value?.openTurnId ?? null;
          if (turnId !== null) return err({ kind: "turn_running", turnId });
        }
        return err({ kind: "thread_closed", threadId });
      case "key_reused":
        // 같은 키에 다른 대상·이유·요약: 호출자가 키를 잘못 쓴 것이라 값으로 돌려준다
        return err({ kind: "key_reused", requestKey: args.requestKey });
      default:
        return assertNever(result, "CommitResult");
    }
  };

  const fireTree = (
    threadId: ThreadId,
    newLeaf: EventId,
    oldLeaf: EventId | null,
    result: Extract<CommitResult, { status: "committed" }>,
    withSummary: boolean,
  ): void => {
    if (result.replayed) return;
    const summaryEventId = withSummary ? result.eventIds[1] : undefined;
    detach(
      points.tree(
        {
          threadId,
          newLeafEventId: newLeaf,
          oldLeafEventId: oldLeaf,
          ...(summaryEventId === undefined ? {} : { summaryEventId }),
          fromExtension: null,
        },
        `${threadId}:session.tree.after:${String(result.lastSeq)}`,
      ),
      failPoint("session.tree.after", threadId),
    );
  };

  return {
    async moveLeaf(threadId, target, options) {
      const denied = ownerError(sessions, threadId);
      if (denied !== null) return err(denied);
      const idle = requireIdle(threadId);
      if (!idle.ok) return idle;
      const oldLeaf = idle.value.leafEventId;
      const belongs = readResult(db, (tx) => eventBelongsToThread(tx, threadId, target));
      if (!belongs.ok) return err(belongs.error);
      if (belongs.value === undefined)
        return err({ kind: "invalid_target", reason: "item_not_found" });
      if (oldLeaf === target && options.summary === undefined) {
        return ok({ leaf: target, headSeq: idle.value.headSeq });
      }
      const facts = treeFacts(oldLeaf, target);
      if (!facts.ok) return err(facts.error);
      const decision = await points.beforeTree(
        {
          threadId,
          targetEventId: target,
          oldLeafEventId: oldLeaf,
          commonAncestorEventId: facts.value.ancestor,
          entriesToSummarize: facts.value.entries,
          userWantsSummary: options.summary !== undefined,
        },
        `${threadId}:session.tree.before:${options.requestKey}`,
      );
      const stopped = cancelled("session.tree.before", decision);
      if (stopped !== null) return err(stopped);
      const offered = decision !== undefined && !decision.cancel ? decision.summary : undefined;
      const summary: BranchSummaryInput | undefined =
        options.summary ??
        (offered === undefined
          ? undefined
          : { summary: offered.summary, details: offered.details, usage: null });
      const moved = commitLeafMove({
        threadId,
        target,
        reason: options.reason,
        requestKey: options.requestKey,
        keyPrefix: "leaf",
        summary,
        fingerprintSummary: options.summary?.summary ?? null,
      });
      if (!moved.ok) return moved;
      const { result } = moved.value;
      fireTree(threadId, result.leaf ?? target, moved.value.oldLeaf, result, summary !== undefined);
      return ok({ leaf: result.leaf ?? target, headSeq: result.lastSeq });
    },

    async revert(threadId, to, requestKey) {
      const denied = ownerError(sessions, threadId);
      if (denied !== null) return err(denied);
      const idle = requireIdle(threadId);
      if (!idle.ok) return idle;
      const oldLeaf = idle.value.leafEventId;
      const checked = readResult(
        db,
        (
          tx,
        ): Result<
          | { readonly target: EventId }
          | { readonly refused: Extract<LifecycleError, { kind: "invalid_target" }> },
          RowFault
        > => {
          const found = itemEvent(tx, threadId, to);
          if (!found.ok) return found;
          if (found.value === undefined) {
            return ok({ refused: { kind: "invalid_target", reason: "item_not_found" } });
          }
          const target = found.value;
          const seq = eventBelongsToThread(tx, threadId, target);
          if (!seq.ok) return seq;
          if (seq.value === undefined) return err(rowInvalid("p_items.event_id"));
          const ref: BranchEventRef = { id: target, seq: seq.value.seq };
          if (!isOnBranch(tx, oldLeaf, ref)) {
            return ok({ refused: { kind: "invalid_target", reason: "not_on_branch" } });
          }
          const open = tx.get(
            "SELECT 1 AS hit FROM p_effects WHERE thread_id = ? AND result_seq IS NULL LIMIT 1",
            [threadId],
          );
          if (open !== undefined) {
            return ok({ refused: { kind: "invalid_target", reason: "open_tool_calls" } });
          }
          const facts = itemFacts(tx, threadId, target);
          if (!facts.ok) return facts;
          if (facts.value === undefined) return err(rowInvalid("p_items.event_id"));
          const { kind, stopReason, turnId, seq: itemSeq } = facts.value;
          const closesTurn = kind === "user" || (kind === "assistant" && stopReason !== "toolUse");
          if (!closesTurn && turnId !== null && oldLeaf !== null) {
            const later = hasLaterItemInTurn(tx, oldLeaf, turnId, itemSeq);
            if (!later.ok) return later;
            if (later.value)
              return ok({ refused: { kind: "invalid_target", reason: "inside_turn" } });
          }
          return ok({ target });
        },
      );
      if (!checked.ok) return err(checked.error);
      if ("refused" in checked.value) return err(checked.value.refused);
      const { target } = checked.value;
      if (oldLeaf === target) return ok({ leaf: target, headSeq: idle.value.headSeq });
      const facts = treeFacts(oldLeaf, target);
      if (!facts.ok) return err(facts.error);
      const decision = await points.beforeTree(
        {
          threadId,
          targetEventId: target,
          oldLeafEventId: oldLeaf,
          commonAncestorEventId: facts.value.ancestor,
          entriesToSummarize: facts.value.entries,
          userWantsSummary: false,
        },
        `${threadId}:session.tree.before:${requestKey}`,
      );
      const stopped = cancelled("session.tree.before", decision);
      if (stopped !== null) return err(stopped);
      const moved = commitLeafMove({
        threadId,
        target,
        reason: "rewind",
        requestKey,
        keyPrefix: "revert",
        summary: undefined,
        fingerprintSummary: null,
      });
      if (!moved.ok) return moved;
      const { result } = moved.value;
      fireTree(threadId, result.leaf ?? target, moved.value.oldLeaf, result, false);
      return ok({ leaf: result.leaf ?? target, headSeq: result.lastSeq });
    },

    async fork(threadId, at, newThreadId) {
      const source = readResult(db, (tx) => {
        const thread = readThread(tx, threadId);
        if (!thread.ok) return thread;
        if (thread.value === undefined) return ok(undefined);
        // 출처 이벤트와 지점 payload의 itemId: at이 있으면 그 item, 없으면 활성 가지의 마지막 item
        let itemId: ItemId | undefined = at;
        let eventId: EventId | undefined;
        if (at !== undefined) {
          const found = itemEvent(tx, threadId, at);
          if (!found.ok) return found;
          eventId = found.value;
        } else {
          eventId = thread.value.leafEventId ?? undefined;
          const last = lastBranchItem(tx, thread.value.leafEventId);
          if (!last.ok) return last;
          itemId = last.value;
        }
        let onBranch = false;
        if (eventId !== undefined) {
          const seq = eventBelongsToThread(tx, threadId, eventId);
          if (!seq.ok) return seq;
          onBranch =
            seq.value !== undefined &&
            isOnBranch(tx, thread.value.leafEventId, { id: eventId, seq: seq.value.seq });
        }
        return ok({ thread: thread.value, itemId, eventId, onBranch });
      });
      if (!source.ok) return err(source.error);
      if (source.value === undefined) return err({ kind: "thread_not_found", threadId });
      const { thread, itemId, eventId, onBranch } = source.value;
      if (eventId === undefined || itemId === undefined) {
        return err({ kind: "invalid_target", reason: "item_not_found" });
      }
      if (!onBranch) return err({ kind: "invalid_target", reason: "not_on_branch" });
      const decision = await points.beforeFork(
        { threadId, itemId, position: "at" },
        `${threadId}:session.fork.before:${newThreadId}`,
      );
      const stopped = cancelled("session.fork.before", decision);
      if (stopped !== null) return err(stopped);
      const created = deps.createForked(
        {
          threadId: newThreadId,
          ...(thread.title === null ? {} : { title: thread.title }),
          ...(thread.workspace === null ? {} : { workspace: thread.workspace }),
        },
        { threadId, eventId },
      );
      if (!created.ok) return created;
      if (!created.value.replayed) {
        detach(
          points.start(
            { reason: "fork", threadId: newThreadId, previousThreadId: threadId },
            `${newThreadId}:session.start:${String(created.value.headSeq)}`,
          ),
          failPoint("session.start", newThreadId),
        );
      }
      return created;
    },

    async prepareSwitch(from, to) {
      const decision = await points.beforeSwitch(
        from,
        { reason: to === null ? "new" : "resume", ...(to === null ? {} : { targetThreadId: to }) },
        `${from}:session.switch.before:${to ?? "new"}`,
      );
      const stopped = cancelled("session.switch.before", decision);
      return stopped === null ? ok(undefined) : err(stopped);
    },
  };
}

/** 활성 가지의 마지막 item id. item이 없으면 undefined */
function lastBranchItem(tx: SqlTx, leaf: EventId | null): Result<ItemId | undefined, RowFault> {
  if (leaf === null) return ok(undefined);
  const row = tx.get(
    `WITH RECURSIVE chain(id) AS (
       SELECT id FROM events WHERE id = ?
       UNION ALL
       SELECT e.parent_id FROM chain c JOIN events e ON e.id = c.id WHERE e.parent_id IS NOT NULL
     )
     SELECT i.item_id AS item_id FROM chain c JOIN p_items i ON i.event_id = c.id
     ORDER BY i.seq DESC LIMIT 1`,
    [leaf],
  );
  if (row === undefined) return ok(undefined);
  return columns(row, "p_items").id("itm", "item_id");
}
