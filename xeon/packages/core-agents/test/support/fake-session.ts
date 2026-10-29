// core-persistence의 SessionService 부분을 흉내 내는 대역(DR-02). 커밋 키 멱등, 지문 비교, 롤백 없는 단순 커밋,
// 자식 연결(p_agents 규칙), creationKey 멱등 생성, 활성 이벤트 조회만 같은 규칙으로 만든다.
import { Bug, canonicalJson, err, ok, parse, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ItemId, ThreadId } from "@xeon/contracts/conversation";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  type AgentView,
  type CommitListener,
  type CommitPlan,
  type CommitRequest,
  type CommitResult,
  type DraftInput,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type LeaseToken,
  type ProducerHandle,
  type ProducerId,
  type SessionService,
  type StampedDraft,
  type StoreError,
  type TxView,
} from "@xeon/contracts/records";
import type { AgentsSession } from "../../src/index.ts";

const stamped = new WeakSet<object>();

function isStamped(value: object): value is StampedDraft {
  return stamped.has(value);
}

function stamp(draft: DurableEventDraft, producer: ProducerId): StampedDraft {
  const candidate = { draft, producer };
  stamped.add(candidate);
  if (!isStamped(candidate)) throw new Bug("fakeSession: stamp registry lost a draft");
  return candidate;
}

/** AgentView의 변경 가능한 사본(정착이 채운다) */
interface Link {
  readonly childThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly requestId: string;
  readonly ownerTurnId: AgentView["ownerTurnId"];
  readonly background: boolean;
  readonly depth: number;
  settled: AgentView["settled"];
}

export interface FakeSession extends AgentsSession, Pick<SessionService, "feed"> {
  producer(id: ProducerId): ProducerHandle;
  readonly events: readonly DurableEventEnvelope[];
  readonly created: readonly ThreadId[];
  readonly opened: readonly ThreadId[];
  readonly released: readonly ThreadId[];
  /** 자식 thread에 어시스턴트 item을 남긴다(runChildTurn의 결과 대역이 부른다) */
  seedAssistantItem(threadId: ThreadId, text: string): ItemId;
  /** 이 turn에 취소 의도가 있는 것으로 한다(parent_aborting 시험) */
  markAbortRequested(turnId: string): void;
  /** 다음 commit n번을 실패시킨다 */
  failNextCommit(error: StoreError, times?: number): void;
  /** 부모의 쓰기 토큰 */
  tokenOf(threadId: ThreadId): LeaseToken;
  setThreadClosed(threadId: ThreadId): void;
}

interface StoredRequest {
  readonly fingerprint: string;
  readonly result: CommitResult;
}

export function fakeSession(ids: IdFactory): FakeSession {
  const events: DurableEventEnvelope[] = [];
  const requests = new Map<string, StoredRequest>();
  const threads = new Map<ThreadId, { status: "idle" | "closed"; leaf: EventId | null }>();
  const creationKeys = new Map<string, ThreadId>();
  const links = new Map<string, Link>();
  const aborted = new Set<string>();
  const listeners = new Set<CommitListener>();
  const created: ThreadId[] = [];
  const opened: ThreadId[] = [];
  const released: ThreadId[] = [];
  const failures: StoreError[] = [];
  let seq = 0;

  const viewOfLink = (link: Link): AgentView => ({
    childThreadId: link.childThreadId,
    parentThreadId: link.parentThreadId,
    requestId: link.requestId,
    ownerTurnId: link.ownerTurnId,
    background: link.background,
    depth: link.depth,
    settled: link.settled,
  });

  const makeEnvelope = (draft: DurableEventDraft): DurableEventEnvelope => {
    seq += 1;
    const thread = threads.get(draft.threadId);
    const envelope: DurableEventEnvelope = {
      ...draft,
      seq,
      recordedAt: 1_767_571_200_000 + seq,
      parentId: draft.parentId === undefined ? (thread?.leaf ?? null) : draft.parentId,
    };
    events.push(envelope);
    if (thread !== undefined) thread.leaf = envelope.id;
    return envelope;
  };

  const project = (event: DurableEventEnvelope): void => {
    if (event.kind === "agent.spawned") {
      const payload = parse(AgentSpawnedPayloadSchema, event.payload);
      if (!payload.ok) throw new Bug("fakeSession: invalid agent.spawned payload");
      const owner = payload.value.owner;
      links.set(linkKey(event.threadId, payload.value.requestId), {
        childThreadId: payload.value.childThreadId,
        parentThreadId: event.threadId,
        requestId: payload.value.requestId,
        ownerTurnId: owner.kind === "scope" ? null : owner.turnId,
        background: payload.value.background,
        depth: payload.value.depth,
        settled: null,
      });
    } else if (event.kind === "agent.settled") {
      const payload = parse(AgentSettledEventPayloadSchema, event.payload);
      if (!payload.ok) throw new Bug("fakeSession: invalid agent.settled payload");
      const link = links.get(linkKey(event.threadId, payload.value.requestId));
      if (link !== undefined) {
        link.settled = { status: payload.value.status, eventId: event.id };
      }
    }
  };

  const viewFor = (threadId: ThreadId): TxView => ({
    threadId,
    headSeq: seq,
    leaf: threads.get(threadId)?.leaf ?? null,
    threadStatus: threads.get(threadId)?.status ?? "absent",
    turn: () => undefined,
    turnAbortRequested: (turnId) => aborted.has(turnId),
    effect: () => undefined,
    effectByToolCall: () => undefined,
    turnByRequestId: () => undefined,
    scopeLeaseEpoch: () => 0,
    inputByRequestId: () => undefined,
    queuedInputs: () => [],
    approval: () => undefined,
    agentByRequestId(parent, requestId) {
      const link = links.get(linkKey(parent, requestId));
      return link === undefined ? undefined : viewOfLink(link);
    },
    scopeStateRev: () => 0,
    lastCheckpoint: () => null,
  });

  const commit = (request: CommitRequest): Result<CommitResult, StoreError> => {
    const failure = failures.shift();
    if (failure !== undefined) return err(failure);
    const key = `${request.threadId}|${request.requestId}`;
    const fingerprint = canonicalJson(request.fingerprintSource);
    const prior = requests.get(key);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        return ok({ status: "key_reused", requestId: request.requestId });
      }
      return ok(
        prior.result.status === "key_reused" ? prior.result : { ...prior.result, replayed: true },
      );
    }
    const plan: CommitPlan = request.build(viewFor(request.threadId));
    if (plan.kind === "abort") return err(plan.error);
    if (plan.kind === "reject") {
      const rejected: CommitResult = {
        status: "rejected",
        code: plan.code,
        detail: plan.detail,
        replayed: false,
      };
      requests.set(key, { fingerprint, result: rejected });
      return ok(rejected);
    }
    const appended = plan.drafts.map((entry) => makeEnvelope(entry.draft));
    for (const event of appended) project(event);
    const first = appended[0];
    const last = appended[appended.length - 1];
    if (first === undefined || last === undefined) throw new Bug("fakeSession: empty commit");
    const result: CommitResult = {
      status: "committed",
      firstSeq: first.seq,
      lastSeq: last.seq,
      leaf: threads.get(request.threadId)?.leaf ?? null,
      eventIds: appended.map((event) => event.id),
      replayed: false,
    };
    requests.set(key, { fingerprint, result });
    for (const listener of listeners) {
      listener({ firstSeq: first.seq, lastSeq: last.seq, events: appended });
    }
    return ok(result);
  };

  const session: FakeSession = {
    events,
    created,
    opened,
    released,
    commit,
    producer(id) {
      return {
        producer: id,
        draft(input: DraftInput): StampedDraft {
          return stamp({ ...input, durable: true, version: input.version ?? 1 }, id);
        },
      };
    },
    feed: {
      headSeq: () => ok(seq),
      oldestReplayableSeq: () => 0,
      read: () => ok({ events: [], scannedTo: seq }),
      onCommit(listener: CommitListener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      onVolatile: () => () => {},
    },
    threads: {
      create(input) {
        if (input.creationKey !== undefined) {
          const existing = creationKeys.get(input.creationKey);
          if (existing !== undefined) {
            return ok({ threadId: existing, headSeq: 1, replayed: true, token: null });
          }
        }
        threads.set(input.threadId, { status: "idle", leaf: null });
        creationKeys.set(input.creationKey ?? `none:${input.threadId}`, input.threadId);
        created.push(input.threadId);
        makeEnvelope({
          id: ids.next("evt"),
          kind: "thread.started",
          version: 1,
          threadId: input.threadId,
          turnId: null,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: { title: input.title ?? null, forkedFrom: null },
          durable: true,
        });
        const token: LeaseToken | null =
          input.inheritOwnerFrom === undefined
            ? null
            : {
                resource: `session:${input.threadId}`,
                holderId: input.inheritOwnerFrom.holderId,
                epoch: 1,
              };
        return ok({ threadId: input.threadId, headSeq: seq, replayed: false, token });
      },
      list: () => ({
        threads: [...threads].map(([threadId, thread]) => ({
          threadId,
          title: null,
          status: thread.status,
          workspace: null,
          createdAt: 0,
          updatedAt: 0,
          headSeq: seq,
          forkedFrom: null,
          marker: null,
          queuedInputs: 0,
          pendingApprovals: 0,
        })),
        nextCursor: null,
      }),
      close: () => unsupported("threads.close"),
      remove: () => unsupported("threads.remove"),
      fork: () => Promise.reject(new Bug("fakeSession: threads.fork is not supported")),
      revert: () => Promise.reject(new Bug("fakeSession: threads.revert is not supported")),
      moveLeaf: () => Promise.reject(new Bug("fakeSession: threads.moveLeaf is not supported")),
      setTitle: () => unsupported("threads.setTitle"),
      prepareSwitch: () => Promise.resolve(ok(undefined)),
    },
    query: {
      thread: () => ok(undefined),
      turn: () => ok(undefined),
      openTurn: () => ok(undefined),
      turnByRequestId: () => ok(undefined),
      openEffects: () => ok([]),
      queuedInputs: () => ok([]),
      pendingApprovals: () => ok([]),
      childAgents(parent, options) {
        const rows = [...links.values()]
          .filter((link) => link.parentThreadId === parent)
          .filter((link) => options?.unsettledOnly !== true || link.settled === null)
          .map(viewOfLink);
        return ok(rows);
      },
      branchItems: () => ok([]),
      itemEvent: () => ok(undefined),
      latestEvent(threadId, kind, match) {
        const found = events.toReversed().find((event) => {
          if (event.threadId !== threadId || event.kind !== kind) return false;
          if (match === undefined) return true;
          const payload: unknown = event.payload;
          return pointerValue(payload, match.pointer) === match.equals;
        });
        return ok(found);
      },
      liveBlobRefs: () => ok([]),
    },
    hydrate: (event) => Promise.resolve(event),
    openForWrite(threadId) {
      opened.push(threadId);
      return ok({
        threadId,
        role: "owner",
        headSeq: seq,
        marker: null,
        readOnly: null,
        rebuilt: [],
        owner: null,
      });
    },
    release(threadId) {
      released.push(threadId);
      return Promise.resolve();
    },
    seedAssistantItem(threadId, text) {
      const itemId = ids.next("itm");
      makeEnvelope({
        id: ids.next("evt"),
        kind: "item.recorded",
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: {
          item: {
            itemId,
            status: "completed",
            kind: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text }],
              api: "test",
              provider: "test",
              model: "tape",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: 1,
            },
            partIds: [],
          },
        },
        durable: true,
      });
      return itemId;
    },
    markAbortRequested(turnId) {
      aborted.add(turnId);
    },
    failNextCommit(error, times = 1) {
      for (let i = 0; i < times; i += 1) failures.push(error);
    },
    tokenOf(threadId) {
      return { resource: `session:${threadId}`, holderId: "holder-a", epoch: 1 };
    },
    setThreadClosed(threadId) {
      const thread = threads.get(threadId);
      if (thread !== undefined) thread.status = "closed";
    },
  };
  return session;
}

function linkKey(parent: ThreadId, requestId: string): string {
  return `${parent}|${requestId}`;
}

function unsupported(name: string): never {
  throw new Bug(`fakeSession: ${name} is not supported`);
}

function pointerValue(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = new Map(Object.entries(current)).get(raw);
  }
  return current;
}
