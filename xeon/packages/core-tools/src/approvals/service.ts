import { Bug, err, ok, parse, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  StepCheckpointSchema,
  type PendingToolCall,
  type ProducerHandle,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StepCheckpointInput,
} from "@xeon/contracts/records";
import type {
  ApprovalOrigin,
  ApprovalRequest,
  ApprovalRequestInput,
  ApprovalResolution,
  ApprovalResponse,
  ApprovalService,
  ToolRunContext,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import { commitWithRetry, type CommitFailure } from "../commit.ts";
import { messageOf } from "../util.ts";
import { scanApprovals } from "./pending.ts";
import { requestCommitKey, resolveCommitKey, validateResponse } from "./protocol.ts";

// L1.tools.spec §3.6, §4.7 승인 대기. M1은 kind "tool"만 요청을 받는다(plan, question은 M2, TL-12).

export interface ApprovalDeps {
  readonly session: Pick<SessionService, "commit" | "readBranch">;
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly logger: Logger | undefined;
  /** 활성 호출 표에서 origin의 실행 맥락을 찾는다. 대기 체크포인트 초안을 만들 때 쓴다 */
  readonly runOf: (origin: ApprovalOrigin) => ToolRunContext | undefined;
}

/** 파이프라인이 쓰는 확장: 커밋 실패를 값으로 받고, 세션 허용 목록을 조회한다 */
export interface ApprovalsInternal extends ApprovalService {
  requestTool(
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, CommitFailure>>;
  /** remember "thread"로 허용된 (도구, 규칙)인가 */
  isRemembered(surfaceThreadId: ThreadId, toolName: string, ruleId: string | null): boolean;
}

type EntryState = "pending" | "settling" | "resolved";

interface Entry {
  readonly eventId: EventId;
  readonly request: ApprovalRequest;
  state: EntryState;
  resolution: ApprovalResolution | undefined;
  readonly waiters: Set<(resolution: ApprovalResolution) => void>;
}

function rememberKey(surfaceThreadId: string, toolName: string, ruleId: string | null): string {
  return `${surfaceThreadId}\0${toolName}\0${ruleId ?? ""}`;
}

function cancelledResolution(request: ApprovalRequest): ApprovalResolution {
  return {
    approvalId: request.approvalId,
    decision: "deny",
    answer: null,
    remember: "once",
    requestedRemember: null,
    resolvedBy: "cancelled",
  };
}

/**
 * 루프가 만든 대기 체크포인트 초안(F ToolRunDrafts.waitingCheckpoint: DurableEventDraft)을 커밋 계획의 체크포인트 입력으로 바꾼다.
 * checkpoint.step은 core.persistence 소유라 core.tools가 초안으로 넣을 수 없다. 저장소가 `CommitPlan.checkpoint`로 받아
 * checkpointId, schemaVersion, threadId, leafEventId를 채우고 같은 커밋 끝에 붙인다(L1.persistence.spec §4.1 8단계, A1).
 */
function waitingCheckpointInput(draft: unknown): StepCheckpointInput {
  const payload: unknown =
    typeof draft === "object" && draft !== null && "payload" in draft ? draft.payload : undefined;
  const parsed = parse(StepCheckpointSchema, payload);
  if (!parsed.ok) {
    // xeon-disable-next-line xeon/bug-for-expected -- 루프가 만든 대기 체크포인트가 StepCheckpoint가 아니면 L1 사이 계약 위반이다 (eng.typescript.guide TY-24)
    throw new Bug(
      "tools.waiting_checkpoint_invalid: the loop's waiting checkpoint is not a StepCheckpoint",
      {
        cause: parsed.error,
      },
    );
  }
  const {
    checkpointId: _id,
    schemaVersion: _version,
    threadId: _thread,
    leafEventId: _leaf,
    ...input
  } = parsed.value;
  return input;
}

function keyOf(surfaceThreadId: string, requestKey: string): string {
  return `${surfaceThreadId}\0${requestKey}`;
}

function scopeIds(request: ApprovalRequest): {
  readonly turnId: ApprovalOrigin["turnId"];
  readonly stepId: ApprovalOrigin["stepId"];
} {
  // 서브에이전트 요청은 부모 대화에 기록되므로 자식의 turn·step을 이 이벤트에 달지 않는다
  return request.origin.threadId === request.surfaceThreadId
    ? { turnId: request.origin.turnId, stepId: request.origin.stepId }
    : { turnId: null, stepId: null };
}

export function createApprovalService(deps: ApprovalDeps): ApprovalsInternal {
  const byId = new Map<string, Entry>();
  const byKey = new Map<string, string>();
  const remembered = new Set<string>();

  function add(eventId: EventId, request: ApprovalRequest): Entry {
    const entry: Entry = {
      eventId,
      request,
      state: "pending",
      resolution: undefined,
      waiters: new Set(),
    };
    byId.set(request.approvalId, entry);
    byKey.set(keyOf(request.surfaceThreadId, request.requestKey), request.approvalId);
    return entry;
  }

  function applyRemember(entry: Entry, resolution: ApprovalResolution): void {
    const { body } = entry.request;
    if (
      body.kind === "tool" &&
      resolution.decision === "allow" &&
      resolution.remember === "thread"
    ) {
      remembered.add(
        rememberKey(entry.request.surfaceThreadId, body.tool.toolName, body.tool.ruleId),
      );
    }
  }

  async function prompt(entry: Entry, phase: "start" | "end"): Promise<void> {
    const { request } = entry;
    const payload = { reason: "ui_prompt", kind: "confirm", title: request.title } as const;
    const options = {
      threadId: request.surfaceThreadId,
      dispatchKey: `approval:${request.approvalId}:ui_prompt_${phase}`,
    };
    try {
      if (phase === "start") await deps.ext.dispatch("ui_prompt_start", payload, options);
      else await deps.ext.dispatch("ui_prompt_end", payload, options);
    } catch (error) {
      // 탭 지점의 실패는 기록하고 계속한다(F.extensions.spec §4.1)
      deps.logger?.warn("tools.ui_prompt_failed", { phase, message: messageOf(error) });
    }
  }

  function settle(entry: Entry, resolution: ApprovalResolution): void {
    entry.state = "resolved";
    entry.resolution = resolution;
    applyRemember(entry, resolution);
    for (const waiter of entry.waiters) waiter(resolution);
    entry.waiters.clear();
  }

  /** approval.resolved 커밋. 성공하면 entry를 해결 상태로 바꾼다 */
  async function commitResolution(
    entry: Entry,
    resolution: ApprovalResolution,
  ): Promise<Result<void, CommitFailure>> {
    const { request } = entry;
    const ids = scopeIds(request);
    const draft = deps.producer.draft({
      id: deps.ids.next("evt"),
      kind: "approval.resolved",
      threadId: request.surfaceThreadId,
      ...ids,
      causationId: entry.eventId,
      correlationId: null,
      payload: resolution,
    });
    const committed = commitWithRetry(deps.session, {
      threadId: request.surfaceThreadId,
      requestId: resolveCommitKey(request.approvalId),
      fingerprintSource: {
        kind: "approval.resolved",
        approvalId: request.approvalId,
        decision: resolution.decision,
        resolvedBy: resolution.resolvedBy,
      },
      build: (view) => {
        const known = view.approval(entry.eventId);
        if (known === undefined) return { kind: "reject", code: "approval_missing", detail: null };
        if (known.resolved) return { kind: "reject", code: "already_resolved", detail: null };
        return { kind: "append", drafts: [draft], checkpoint: null };
      },
    });
    if (!committed.ok) return err(committed.failure);
    settle(entry, resolution);
    await prompt(entry, "end");
    return ok(undefined);
  }

  /** approval.requested(+ 대기 체크포인트) 한 커밋. 같은 requestKey는 기존 요청을 돌려준다 */
  async function open(
    input: ApprovalRequestInput,
    surfaceThreadId: ThreadId,
  ): Promise<Result<Entry, CommitFailure>> {
    const knownId = byKey.get(keyOf(surfaceThreadId, input.requestKey));
    const known = knownId === undefined ? undefined : byId.get(knownId);
    if (known !== undefined) return ok(known);

    const requestedAt = deps.clock.now();
    const sameThread = input.origin.threadId === surfaceThreadId;
    const draft = deps.producer.draft({
      id: deps.ids.next("evt"),
      kind: "approval.requested",
      threadId: surfaceThreadId,
      turnId: sameThread ? input.origin.turnId : null,
      stepId: sameThread ? input.origin.stepId : null,
      causationId: null,
      correlationId: null,
      payload: {
        origin: input.origin,
        requestKey: input.requestKey,
        title: input.title,
        body: input.body,
        remember: input.remember,
        surfaceThreadId,
        requestedAt,
      },
    });
    const drafts: StampedDraft[] = [draft];
    const run = deps.runOf(input.origin);
    let checkpoint: StepCheckpointInput | null = null;
    if (run !== undefined && input.origin.toolCallId !== null && input.body.kind === "tool") {
      const waiting: PendingToolCall = {
        toolCallId: input.origin.toolCallId,
        effectId: null,
        waiting: "approval",
      };
      // 대기 체크포인트 내용은 루프가 만든다. 저장소가 같은 커밋에 checkpoint.step으로 붙인다(A1)
      checkpoint = waitingCheckpointInput(run.drafts.waitingCheckpoint([waiting]));
    }
    const committed = commitWithRetry(deps.session, {
      threadId: surfaceThreadId,
      requestId: await requestCommitKey(surfaceThreadId, input.requestKey),
      fingerprintSource: {
        kind: "approval.requested",
        requestKey: input.requestKey,
        toolCallId: input.origin.toolCallId,
        bodyKind: input.body.kind,
      },
      build: () => ({ kind: "append", drafts, checkpoint }),
    });
    if (!committed.ok) return err(committed.failure);

    const eventId = committed.result.eventIds[0];
    if (eventId === undefined) throw new Bug("tools.approval_event_missing");
    const request: ApprovalRequest = {
      ...input,
      approvalId: eventId,
      surfaceThreadId,
      requestedAt,
    };
    const entry = add(eventId, request);
    if (committed.result.replayed) {
      const adopted = await adoptStoredResolution(entry);
      if (!adopted.ok) return err({ kind: "store", error: adopted.error });
    } else {
      await prompt(entry, "start");
    }
    return ok(entry);
  }

  /** 같은 키의 요청이 이미 커밋되어 있었다면(재시작) 그 사이 응답이 커밋되었는지 이벤트에서 확인한다 */
  async function adoptStoredResolution(entry: Entry): Promise<Result<void, ReadFailure>> {
    const scanned = await scanApprovals(deps.session, entry.request.surfaceThreadId);
    if (!scanned.ok) return scanned;
    const stored = scanned.value.resolved.get(entry.request.approvalId);
    if (stored !== undefined) settle(entry, stored);
    return ok(undefined);
  }

  function waitFor(entry: Entry, signal: AbortSignal): Promise<ApprovalResolution> {
    if (entry.resolution !== undefined) return Promise.resolve(entry.resolution);
    if (signal.aborted) return Promise.resolve(cancelledResolution(entry.request));
    return new Promise<ApprovalResolution>((resolve) => {
      const onAbort = (): void => {
        entry.waiters.delete(waiter);
        resolve(cancelledResolution(entry.request));
      };
      const waiter = (resolution: ApprovalResolution): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(resolution);
      };
      entry.waiters.add(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function requestTool(
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, CommitFailure>> {
    if (input.body.kind !== "tool") {
      throw new Bug(`approvals.unsupported_kind: ${input.body.kind} requests arrive in M2 (TL-12)`);
    }
    const run = deps.runOf(input.origin);
    const opened = await open(input, run?.surfaceThreadId ?? input.origin.threadId);
    if (!opened.ok) return opened;
    return ok(await waitFor(opened.value, signal));
  }

  async function respond(
    approvalId: string,
    response: ApprovalResponse,
  ): Promise<{ readonly applied: boolean }> {
    const entry = byId.get(approvalId);
    if (entry?.state !== "pending") return { applied: false };
    const checked = validateResponse(entry.request, response);
    if (!checked.ok) {
      deps.logger?.warn("tools.approval_response_invalid", {
        approvalId,
        reason: checked.error.kind,
      });
      return { applied: false };
    }
    entry.state = "settling";
    const resolution: ApprovalResolution = {
      approvalId,
      decision: checked.value.decision,
      answer: checked.value.answer,
      remember: checked.value.remember,
      requestedRemember: checked.value.requestedRemember,
      resolvedBy: "user",
    };
    const committed = await commitResolution(entry, resolution);
    if (!committed.ok) {
      entry.state = "pending";
      deps.logger?.warn("tools.approval_resolve_failed", { approvalId });
      return { applied: false };
    }
    return { applied: true };
  }

  async function cancel(
    approvalId: string,
    reason: string,
  ): Promise<{ readonly applied: boolean }> {
    const entry = byId.get(approvalId);
    if (entry?.state !== "pending") return { applied: false };
    entry.state = "settling";
    const committed = await commitResolution(entry, cancelledResolution(entry.request));
    if (!committed.ok) {
      entry.state = "pending";
      return { applied: false };
    }
    deps.logger?.info("tools.approval_cancelled", { approvalId, reason });
    return { applied: true };
  }

  function pending(threadId: ThreadId): readonly ApprovalRequest[] {
    return [...byId.values()]
      .filter((entry) => entry.state !== "resolved" && entry.request.surfaceThreadId === threadId)
      .map((entry) => entry.request);
  }

  async function restore(
    threadId: ThreadId,
  ): Promise<Result<readonly ApprovalRequest[], ReadFailure>> {
    const scanned = await scanApprovals(deps.session, threadId);
    if (!scanned.ok) return scanned;
    for (const { eventId, request } of scanned.value.requests) {
      if (byId.has(request.approvalId)) continue;
      const entry = add(eventId, request);
      const stored = scanned.value.resolved.get(request.approvalId);
      if (stored !== undefined) settle(entry, stored);
    }
    return ok(pending(threadId));
  }

  return {
    request: requestTool,
    requestTool,
    respond,
    pending,
    restore,
    cancel,
    isRemembered(surfaceThreadId, toolName, ruleId) {
      return remembered.has(rememberKey(surfaceThreadId, toolName, ruleId));
    },
  };
}
