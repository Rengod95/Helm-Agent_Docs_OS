import { Bug, canonicalJson, err, ok, parse, type Clock } from "@xeon/contracts";
import type { EffectId, EventId, IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  EffectIntentSchema,
  EffectResultSchema,
  COMMIT_KEY_PATTERN,
  ownerOfKind,
  STEP_CHECKPOINT_SCHEMA_VERSION,
  type ApprovalView,
  type CommitKey,
  type CommitRequest,
  type CommitResult,
  type DurableEventDraft,
  type DurableEventEnvelope,
  type EffectView,
  type ProducerHandle,
  type ProducerId,
  type ProjectionQuery,
  type SessionSettingsLayer,
  type StampedDraft,
  type StepCheckpoint,
  type StepCheckpointInput,
  type ReadFailure,
  type StoreError,
  type TxView,
} from "@xeon/contracts/records";
import { isStampedDraft } from "../effects.ts";
import type { ToolsSession } from "../deps.ts";

// 커밋 기록용 세션 대역(L1.tools.plan §2 testing/fakeSession). 저장소를 흉내 내지 않고 커밋 요청과 이벤트 열을 기록한다.
// 키 멱등(replayed, key_reused), build의 TxView, 생산자 소유 검사만 실제 저장소와 같게 한다.

const COMMIT_KEY = new RegExp(COMMIT_KEY_PATTERN);

export interface RecordedCommit {
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly kinds: readonly string[];
}

export interface FakeSessionOptions {
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** commit 직전에 부른다. StoreError를 돌려주면 그 오류로 실패한다(장애 주입) */
  readonly fault?: (request: CommitRequest) => StoreError | undefined;
}

export interface FakeSession extends ToolsSession {
  readonly events: readonly DurableEventEnvelope[];
  readonly commits: readonly RecordedCommit[];
  /** 이 turn의 취소 의도가 커밋된 것으로 본다 */
  abortTurn(turnId: TurnId): void;
  producer(id: ProducerId): ProducerHandle;
  /** 장애 주입 함수를 바꾼다 */
  setFault(fault: FakeSessionOptions["fault"]): void;
  /** 다음 읽기(query.openEffects, readBranch의 다음 원소) n번을 ReadFailure로 실패시킨다 */
  failNextRead(error: ReadFailure, times?: number): void;
  sessionValues(threadId: ThreadId): ReadonlyMap<string, unknown>;
}

interface StoredRequest {
  readonly fingerprint: string;
  readonly result: CommitResult;
}

function parseEffectId(payload: unknown): EffectId | undefined {
  if (typeof payload !== "object" || payload === null || !("effectId" in payload)) {
    return undefined;
  }
  const parsed = parse(EffectResultSchema.properties.effectId, payload.effectId);
  return parsed.ok ? parsed.value : undefined;
}

export function fakeSession(options: FakeSessionOptions): FakeSession {
  const events: DurableEventEnvelope[] = [];
  const commits: RecordedCommit[] = [];
  const requests = new Map<string, StoredRequest>();
  const effects = new Map<string, { view: EffectView; threadId: ThreadId }>();
  const approvals = new Map<string, ApprovalView>();
  const aborted = new Set<TurnId>();
  const settings = new Map<ThreadId, Map<string, unknown>>();
  let fault = options.fault;
  const readFaults: ReadFailure[] = [];
  let leaf: EventId | null = null;

  function effectsOf(threadId: ThreadId): EffectView[] {
    return [...effects.values()]
      .filter((entry) => entry.threadId === threadId)
      .map((entry) => entry.view);
  }

  function project(event: DurableEventEnvelope): void {
    if (event.kind === "effect.intent") {
      const intent = parse(EffectIntentSchema, event.payload);
      if (!intent.ok) return;
      effects.set(intent.value.effectId, {
        threadId: event.threadId,
        view: {
          effectId: intent.value.effectId,
          toolCallId: intent.value.toolCallId,
          toolName: intent.value.toolName,
          replay: intent.value.replay,
          execCount: 0,
          result: null,
        },
      });
    } else if (event.kind === "effect.exec") {
      const effectId = parseEffectId(event.payload);
      const known = effectId === undefined ? undefined : effects.get(effectId);
      if (known !== undefined) {
        effects.set(known.view.effectId, {
          threadId: known.threadId,
          view: { ...known.view, execCount: known.view.execCount + 1 },
        });
      }
    } else if (event.kind === "effect.result") {
      const result = parse(EffectResultSchema, event.payload);
      const known = result.ok ? effects.get(result.value.effectId) : undefined;
      if (result.ok && known !== undefined) {
        effects.set(known.view.effectId, {
          threadId: known.threadId,
          view: {
            ...known.view,
            result: { status: result.value.status, synthesized: result.value.synthesized },
          },
        });
      }
    } else if (event.kind === "approval.requested") {
      const requested = parse(ApprovalRequestedPayloadSchema, event.payload);
      if (requested.ok) {
        approvals.set(event.id, {
          approvalId: event.id,
          threadId: event.threadId,
          toolCallId: requested.value.origin.toolCallId,
          resolved: false,
        });
      }
    } else if (event.kind === "approval.resolved") {
      const resolved = parse(ApprovalResolvedPayloadSchema, event.payload);
      const known = resolved.ok ? approvals.get(resolved.value.approvalId) : undefined;
      if (known !== undefined) approvals.set(known.approvalId, { ...known, resolved: true });
    }
  }

  function viewFor(threadId: ThreadId): TxView {
    return {
      threadId,
      headSeq: events.length,
      leaf,
      threadStatus: "running",
      turn: () => undefined,
      turnAbortRequested: (turnId) => aborted.has(turnId),
      effect: (effectId) => effects.get(effectId)?.view,
      effectByToolCall: (thread, toolCallId) =>
        effectsOf(thread).find((effect) => effect.toolCallId === toolCallId),
      turnByRequestId: () => undefined,
      scopeLeaseEpoch: () => 0,
      inputByRequestId: () => undefined,
      queuedInputs: () => [],
      approval: (approvalId) => approvals.get(approvalId),
      agentByRequestId: () => undefined,
      scopeStateRev: () => 0,
      lastCheckpoint: () => null,
    };
  }

  /** 주입된 읽기 실패가 있으면 하나 꺼낸다 */
  function injectedRead(): ReadFailure | undefined {
    return readFaults.shift();
  }

  const query: ProjectionQuery = {
    thread: () => ok(undefined),
    turn: () => ok(undefined),
    openTurn: () => ok(undefined),
    turnByRequestId: () => ok(undefined),
    openEffects(threadId) {
      const injected = injectedRead();
      if (injected !== undefined) return err(injected);
      return ok(effectsOf(threadId).filter((effect) => effect.result === null));
    },
    queuedInputs: () => ok([]),
    pendingApprovals: (threadId) =>
      ok([...approvals.values()].filter((view) => view.threadId === threadId && !view.resolved)),
    childAgents: () => ok([]),
    branchItems: () => ok([]),
    itemEvent: () => ok(undefined),
    latestEvent: () => ok(undefined),
    liveBlobRefs: () => ok([]),
  };

  /** 실제 저장소처럼 `CommitPlan.checkpoint`를 core.persistence가 만든 checkpoint.step으로 커밋 끝에 붙인다 */
  function checkpointDrafts(
    threadId: ThreadId,
    input: StepCheckpointInput | null,
  ): readonly StampedDraft[] {
    if (input === null) return [];
    const record: StepCheckpoint = {
      ...input,
      checkpointId: options.ids.next("ckp"),
      schemaVersion: STEP_CHECKPOINT_SCHEMA_VERSION,
      threadId,
      leafEventId: leaf ?? options.ids.next("evt"),
    };
    return [
      session.producer("core.persistence").draft({
        id: options.ids.next("evt"),
        kind: "checkpoint.step",
        threadId,
        turnId: record.turnId,
        stepId: record.stepId,
        causationId: null,
        correlationId: record.turnId,
        payload: record,
      }),
    ];
  }

  function append(threadId: ThreadId, requestId: CommitKey, drafts: readonly StampedDraft[]) {
    const first = events.length + 1;
    const written: DurableEventEnvelope[] = [];
    for (const stamped of drafts) {
      const draft: DurableEventDraft = stamped.draft;
      const envelope: DurableEventEnvelope = {
        ...draft,
        seq: events.length + 1,
        recordedAt: options.clock.now(),
        parentId: leaf,
      };
      events.push(envelope);
      written.push(envelope);
      leaf = envelope.id;
      project(envelope);
    }
    commits.push({
      threadId,
      requestId,
      firstSeq: first,
      lastSeq: events.length,
      kinds: written.map((event) => event.kind),
    });
    const result: CommitResult = {
      status: "committed",
      firstSeq: first,
      lastSeq: events.length,
      leaf,
      eventIds: written.map((event) => event.id),
      replayed: false,
    };
    return result;
  }

  const session: FakeSession = {
    get events() {
      return events;
    },
    get commits() {
      return commits;
    },
    abortTurn: (turnId) => {
      aborted.add(turnId);
    },
    failNextRead: (error, times = 1) => {
      for (let count = 0; count < times; count += 1) readFaults.push(error);
    },
    setFault: (next) => {
      fault = next;
    },
    sessionValues: (threadId) => settings.get(threadId) ?? new Map(),
    commit(request) {
      // 실제 저장소처럼 커밋 키 형식을 검사한다. 어기면 호출한 쪽의 결함이다(L1.persistence.spec §4.1)
      if (!COMMIT_KEY.test(request.requestId)) {
        throw new Bug(`store.schema_invalid: commit key ${request.requestId} is not a COMMIT_KEY`);
      }
      const injected = fault?.(request);
      if (injected !== undefined) return err(injected);
      const key = `${request.threadId}\0${request.requestId}`;
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
      const plan = request.build(viewFor(request.threadId));
      if (plan.kind === "abort") return err(plan.error);
      const result: CommitResult =
        plan.kind === "reject"
          ? { status: "rejected", code: plan.code, detail: plan.detail, replayed: false }
          : append(request.threadId, request.requestId, [
              ...plan.drafts,
              ...checkpointDrafts(request.threadId, plan.checkpoint),
            ]);
      requests.set(key, { fingerprint, result });
      return ok(result);
    },
    producer(id) {
      return {
        producer: id,
        draft(input) {
          const owner = ownerOfKind(input.kind);
          if (owner !== id) {
            throw new Bug(
              `store.prefix_not_owned: ${input.kind} belongs to ${owner ?? "nobody"}, not ${id}`,
            );
          }
          const draft: DurableEventDraft = {
            ...input,
            version: input.version ?? 1,
            durable: true,
          };
          const stamped: unknown = { draft, producer: id };
          if (!isStampedDraft(stamped)) throw new Bug("fakeSession: stamping failed");
          return stamped;
        },
      };
    },
    query,
    readBranch(threadId) {
      const mine = events.filter((event) => event.threadId === threadId);
      return {
        [Symbol.asyncIterator]() {
          let index = 0;
          let failed = false;
          return {
            next: () => {
              if (failed) return Promise.resolve({ done: true as const, value: undefined });
              const injected = injectedRead();
              if (injected !== undefined) {
                failed = true;
                return Promise.resolve({ done: false as const, value: err(injected) });
              }
              const value = mine[index];
              index += 1;
              return Promise.resolve(
                value === undefined
                  ? { done: true as const, value: undefined }
                  : { done: false as const, value: ok(value) },
              );
            },
          };
        },
      };
    },
    sessionSettings: {
      layer(threadId): SessionSettingsLayer {
        const values = settings.get(threadId) ?? new Map<string, unknown>();
        return { scope: "session", values };
      },
      set(threadId, key, value) {
        const values = settings.get(threadId) ?? new Map<string, unknown>();
        values.set(key, value);
        settings.set(threadId, values);
        return ok(undefined);
      },
      reset(threadId, key) {
        settings.get(threadId)?.delete(key);
        return ok(undefined);
      },
    },
  };
  return session;
}
