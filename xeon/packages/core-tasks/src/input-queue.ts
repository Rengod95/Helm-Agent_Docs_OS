import { Bug, assertNever, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  EnqueueError,
  EnqueueRequest,
  EnqueueResult,
  Unsubscribe,
} from "@xeon/contracts/extensions";
import type {
  CommitPlan,
  CommitRequest,
  InputView,
  ReadFailure,
  ProducerHandle,
  StampedDraft,
  TxView,
} from "@xeon/contracts/records";
import type {
  DrainOptions,
  EnqueueReceipt,
  InputDraft,
  InputMode,
  InputQueue,
  InputQueueError,
  PlacementPoint,
  PlacementSelection,
  QueuedInput,
  WithdrawReason,
} from "@xeon/contracts/services";
import { findQueuedEvent, loadQueuedInput, queuedPayloadOf, stateOfInput } from "./input-events.ts";
import { commitWithRetry, describeError, type TasksSession } from "./session-port.ts";
import { inputCommitKey, sourceKeyOf } from "./source-key.ts";
import type { TasksSettingsSource } from "./settings-source.ts";

// L1.tasks.spec §3.6, §4.6~§4.8. M1은 steer·followUp만 받는다(next·aside는 mode_not_supported).

export interface InputQueueDeps {
  readonly session: TasksSession;
  /** core.tasks 생산자. 플러그인 setup에서 한 번만 받는다 */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly settings: TasksSettingsSource;
  readonly log: Logger;
  /** input.* 이벤트가 커밋된 뒤(queued·placed·withdrawn) 동기로 부른다. 활동 집계 알림에 쓴다 */
  readonly onChanged: () => void;
}

export interface InputQueueImpl extends InputQueue {
  /** InputQueuePort.enqueue의 본체. 확장 post의 진입점 */
  enqueuePost(request: EnqueueRequest): Promise<Result<EnqueueResult, EnqueueError>>;
  dispose(): void;
}

function reject(code: string): CommitPlan {
  return { kind: "reject", code, detail: null };
}

export function createInputQueue(deps: InputQueueDeps): InputQueueImpl {
  const { session, producer, ids, settings, log } = deps;
  const listeners = new Set<(threadId: ThreadId) => void>();
  const warnedCursor = new Set<EventId>();

  // ── 초안 ──────────────────────────────────────────────────────────────

  function draftQueued(
    view: TxView,
    draft: InputDraft,
  ): { readonly drafts: readonly StampedDraft[]; readonly existing: InputView | undefined } {
    const existing = view.inputByRequestId(
      draft.threadId,
      sourceKeyOf(draft.source),
      draft.requestId,
    );
    if (existing !== undefined) return { drafts: [], existing };
    const stamped = producer.draft({
      id: ids.next("evt"),
      kind: "input.queued",
      threadId: draft.threadId,
      turnId: null,
      stepId: null,
      causationId: null,
      correlationId: null,
      payload: queuedPayloadOf(draft),
    });
    return { drafts: [stamped], existing: undefined };
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────────

  function enqueueNow(draft: InputDraft): Result<EnqueueReceipt, InputQueueError> {
    if (draft.mode === "next" || draft.mode === "aside") {
      return err({ kind: "mode_not_supported", mode: draft.mode });
    }
    const sourceKey = sourceKeyOf(draft.source);
    const key = inputCommitKey(sourceKey, draft.requestId);
    if (key === null) return err({ kind: "invalid_request_id", requestId: draft.requestId });

    const request: CommitRequest = {
      threadId: draft.threadId,
      requestId: key,
      // 신원만 담는다. 내용이 달라도 같은 requestId의 두 번째 post가 key_reused가 되지 않게 한다(§4.7)
      fingerprintSource: { threadId: draft.threadId, sourceKey, requestId: draft.requestId },
      build(view) {
        if (view.threadStatus === "absent") return reject("thread_not_found");
        if (view.threadStatus === "closed") return reject("thread_closed");
        const queued = draftQueued(view, draft);
        if (queued.existing !== undefined || queued.drafts.length === 0) {
          return reject("duplicate_input");
        }
        // 확장 post의 기록도 input.queued 하나다. 멱등은 커밋 키가 맡는다(U-05)
        return { kind: "append", drafts: queued.drafts, checkpoint: null };
      },
    };

    const result = commitWithRetry(session, request);
    if (!result.ok) return err(result.error);
    const value = result.value;
    switch (value.status) {
      case "committed": {
        const inputId = value.eventIds[0];
        if (inputId === undefined)
          throw new Bug("tasks.enqueue_without_event: commit has no events");
        if (!value.replayed) {
          return ok({ requestId: draft.requestId, duplicate: false, inputId, state: "queued" });
        }
        // 같은 키의 두 번째 enqueue. 기록된 결과의 첫 이벤트가 기존 입력이다
        const state = stateOfInput(session, draft.threadId, { inputId, seq: value.firstSeq });
        if (!state.ok) return state;
        return ok({ requestId: draft.requestId, duplicate: true, inputId, state: state.value });
      }
      case "rejected":
        return fromRejection(draft, sourceKey, value.code);
      case "key_reused":
        // 지문이 신원만 담으므로 정상 경로에서는 생기지 않는다. 커밋 키를 만드는 코드의 결함이다
        log.error("tasks.enqueue_key_reused", { threadId: draft.threadId, requestId: key });
        return err({ kind: "invalid_request_id", requestId: draft.requestId });
      default:
        return assertNever(value, "enqueueNow");
    }
  }

  function fromRejection(
    draft: InputDraft,
    sourceKey: string,
    code: string,
  ): Result<EnqueueReceipt, InputQueueError> {
    switch (code) {
      case "thread_closed":
        return err({ kind: "thread_closed", threadId: draft.threadId });
      case "thread_not_found":
        return err({ kind: "thread_not_found", threadId: draft.threadId });
      case "duplicate_input": {
        // 커밋 키가 달라 requests에는 없지만 투영에 같은 입력이 있다(draftQueued로 다른 커밋에 들어간 입력)
        const found = findQueuedEvent(session, draft.threadId, sourceKey, draft.requestId);
        if (!found.ok) return found;
        if (found.value === undefined) {
          throw new Bug("tasks.duplicate_without_input: projection has the input but no event");
        }
        const state = stateOfInput(session, draft.threadId, found.value);
        if (!state.ok) return state;
        return ok({
          requestId: draft.requestId,
          duplicate: true,
          inputId: found.value.inputId,
          state: state.value,
        });
      }
      // xeon-disable-next-line xeon/switch-default-never -- 거부 코드는 문자열이다. 이 모듈의 build가 정하지 않은 코드는 호출 결함이다 (eng.typescript.guide TY-14)
      default:
        throw new Bug(`tasks.enqueue_rejected: unexpected reject code ${code}`);
    }
  }

  function withdrawNow(
    threadId: ThreadId,
    target: EventId | "all",
    reason: WithdrawReason,
  ): Result<number, InputQueueError> {
    const queuedNow = session.query.queuedInputs(threadId);
    if (!queuedNow.ok) return queuedNow;
    const targets = queuedNow.value.filter((view) => target === "all" || view.inputId === target);
    let count = 0;
    // 입력마다 커밋 하나. 키가 입력 id에 묶여 다시 불러도 한 번만 거둬진다
    for (const view of targets) {
      const request: CommitRequest = {
        threadId,
        requestId: `wd:${view.inputId}`,
        fingerprintSource: { threadId, inputId: view.inputId },
        build(tx) {
          // 그 사이 배치됐거나 거둬졌으면 건드리지 않는다
          if (!tx.queuedInputs(threadId).some((current) => current.inputId === view.inputId)) {
            return reject("not_queued");
          }
          return {
            kind: "append",
            drafts: [
              producer.draft({
                id: ids.next("evt"),
                kind: "input.withdrawn",
                threadId,
                turnId: null,
                stepId: null,
                causationId: view.inputId,
                correlationId: null,
                payload: { inputId: view.inputId, reason },
              }),
            ],
            checkpoint: null,
          };
        },
      };
      const result = commitWithRetry(session, request);
      if (!result.ok) return err(result.error);
      if (result.value.status === "committed" && !result.value.replayed) count += 1;
    }
    return ok(count);
  }

  // ── 읽기와 배치 선택 ──────────────────────────────────────────────────

  function peek(
    threadId: ThreadId,
    modes?: readonly InputMode[],
  ): Result<readonly QueuedInput[], ReadFailure> {
    const out: QueuedInput[] = [];
    const queued = session.query.queuedInputs(threadId);
    if (!queued.ok) return queued;
    for (const view of queued.value.toSorted((a, b) => a.seq - b.seq)) {
      if (modes !== undefined && !modes.includes(view.mode)) continue;
      const loaded = loadQueuedInput(session, log, threadId, view);
      if (!loaded.ok) return loaded;
      if (loaded.value !== undefined) out.push(loaded.value);
    }
    return ok(out);
  }

  /** 체크포인트의 소비 위치보다 앞선 queued 입력은 투영과 체크포인트가 어긋난 것이다. 이벤트가 정본이라 투영을 따르고 진단만 남긴다(§4.8 2번) */
  function diagnoseCursor(view: TxView, threadId: ThreadId, queued: readonly InputView[]): number {
    const consumed = view.lastCheckpoint(threadId)?.inputCursor.consumedSeq ?? 0;
    for (const input of queued) {
      if (input.seq > consumed || warnedCursor.has(input.inputId)) continue;
      warnedCursor.add(input.inputId);
      log.warn("tasks.queue_cursor_mismatch", {
        threadId,
        inputId: input.inputId,
        seq: input.seq,
        consumedSeq: consumed,
      });
    }
    return consumed;
  }

  function selectViews(startable: readonly InputView[], at: PlacementPoint): readonly InputView[] {
    const [oldest] = startable;
    if (oldest === undefined) return [];
    switch (at) {
      case "turnStart":
        // 가장 오래된 시작 가능 입력 하나. followUpMode가 all이면 followUp 전부가 한 turn의 입력이 된다
        return oldest.mode === "followUp" && settings.followUpMode() === "all"
          ? startable.filter((input) => input.mode === "followUp")
          : [oldest];
      case "stepEnd": {
        // steer만 고른다. followUp은 turn이 정착한 뒤 새 turn의 입력이 된다
        const steers = startable.filter((input) => input.mode === "steer");
        return settings.steeringMode() === "all" ? steers : steers.slice(0, 1);
      }
      default:
        return assertNever(at, "selectViews");
    }
  }

  function drain(
    view: TxView,
    threadId: ThreadId,
    at: PlacementPoint,
    // continuing은 next·aside를 고를 때 쓴다(M2). M1은 steer·followUp만 받는다
    _options: DrainOptions,
  ): Result<PlacementSelection, ReadFailure> {
    const queued = [...view.queuedInputs(threadId)].toSorted((a, b) => a.seq - b.seq);
    const consumedBefore = diagnoseCursor(view, threadId, queued);
    const startable = queued.filter((input) => input.mode === "steer" || input.mode === "followUp");
    const inputs: QueuedInput[] = [];
    for (const chosen of selectViews(startable, at)) {
      const loaded = loadQueuedInput(session, log, threadId, chosen);
      if (!loaded.ok) return loaded;
      if (loaded.value !== undefined) inputs.push(loaded.value);
    }
    return ok({
      inputs,
      // 선택한 입력 중 가장 큰 seq. 선택이 없으면 직전 값. 줄어들지 않는다
      consumedSeq: inputs.reduce((max, input) => Math.max(max, input.seq), consumedBefore),
      drafts(placements) {
        return placements.map((placement) => {
          if (!inputs.some((input) => input.inputId === placement.inputId)) {
            throw new Bug(`tasks.unknown_placement: ${placement.inputId} was not selected`);
          }
          return producer.draft({
            id: ids.next("evt"),
            kind: "input.placed",
            threadId,
            turnId: placement.turnId,
            stepId: null,
            causationId: placement.inputId,
            correlationId: null,
            payload: { inputId: placement.inputId, itemId: placement.itemId },
          });
        });
      },
    });
  }

  // ── 커밋 후 알림 ──────────────────────────────────────────────────────

  // 모든 input.queued를 한 곳에서 본다. 다른 도메인의 커밋에 든 입력(draftQueued)도 같다(TX-09: 알림 안에서 커밋하지 않는다)
  const unsubscribeFeed = session.feed.onCommit((batch) => {
    const queuedThreads = new Set<ThreadId>();
    let changed = false;
    for (const event of batch.events) {
      if (!event.kind.startsWith("input.")) continue;
      changed = true;
      if (event.kind === "input.queued") queuedThreads.add(event.threadId);
    }
    for (const threadId of queuedThreads) {
      for (const listener of listeners) {
        try {
          listener(threadId);
        } catch (cause) {
          log.error("tasks.on_queued_listener_failed", { threadId, error: describeError(cause) });
        }
      }
    }
    if (changed) deps.onChanged();
  });

  return {
    enqueue(draft) {
      return new Promise((resolve) => {
        resolve(enqueueNow(draft));
      });
    },
    draftQueued,
    peek,
    drain,
    withdraw(threadId, target, reason) {
      return new Promise((resolve) => {
        resolve(withdrawNow(threadId, target, reason));
      });
    },
    onQueued(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueuePost(request) {
      return new Promise<Result<EnqueueResult, EnqueueError>>((resolve) => {
        const result = enqueueNow({
          threadId: request.threadId,
          mode: request.when,
          item: request.item,
          requestId: request.requestId,
          source: { type: "extension", scopeId: request.scopeId },
        });
        resolve(result.ok ? ok({ duplicate: result.value.duplicate }) : err(result.error));
      });
    },
    dispose() {
      unsubscribeFeed();
      listeners.clear();
    },
  };
}
