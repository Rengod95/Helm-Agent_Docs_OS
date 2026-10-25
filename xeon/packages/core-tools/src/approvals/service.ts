import { Bug, err, ok, parse, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { EffectId, EventId, IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  StepCheckpointSchema,
  type PendingToolCall,
  type ProducerHandle,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StepCheckpointInput,
} from "@xeon/contracts/records";
import {
  PERMISSION_MODE_STRICTNESS,
  type ApprovalOrigin,
  type ApprovalWaitFailure,
  type OpenedApproval,
  type ApprovalRequest,
  type ApprovalRequestInput,
  type ApprovalResolution,
  type ApprovalResponse,
  type ApprovalService,
  type ModeChangeResult,
  type PermissionMode,
  type ToolRunContext,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import { commitWithRetry, type CommitFailure } from "../commit.ts";
import { isJsonObject, messageOf } from "../util.ts";
import { requestCommitKey, resolveCommitKey } from "./keys.ts";
import { scanApprovals } from "./pending.ts";
import { requestIssue, validateResponse } from "./protocol.ts";

// L1.tools.spec §3.6, §4.7 승인 대기. 도구 승인(tool), 계획 승인(plan), 질문(question)이 하나의 대기 형식을 쓴다.
// L2 능력은 자기 도구의 실행 안에서 `request`(또는 비차단 `open`+`wait`)를 부른다.

/** 승인을 일으킨 도구 호출의 활성 상태. 대기 체크포인트 초안과 비대화형 판정에 쓴다 */
interface ActiveCall {
  readonly run: ToolRunContext;
  /** 커밋된 effect.intent. 도구 실행 안에서 일어난 요청(질문, 계획)이면 있고, 정책 승인(실행 전)이면 없다 */
  readonly effectId: EffectId | null;
}

export interface ApprovalDeps {
  readonly session: Pick<SessionService, "commit" | "readBranch">;
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly logger: Logger | undefined;
  /** 활성 호출 표에서 origin의 호출을 찾는다. 없으면 턴 밖의 요청(그룹 코드)이다 */
  readonly callOf: (origin: ApprovalOrigin) => ActiveCall | undefined;
  /** 계획 승인의 `{ mode }`를 적용한다(ToolService.setMode "plan_approval") */
  readonly setMode: (threadId: ThreadId, mode: PermissionMode) => Promise<ModeChangeResult>;
  readonly modeOf: (threadId: ThreadId) => PermissionMode;
  /** 메모리에 남기는 해결된 요청의 수 상한(기본 `RESOLVED_KEPT`). 시험이 작은 값을 넣는다 */
  readonly resolvedKept?: number;
}

/**
 * 해결된 요청을 메모리 표(byId, byKey)에 남기는 기본 수. 해결된 요청은 args 페이로드를 쥐고 있어 무한히 쌓이면 안 된다.
 * 넘으면 가장 먼저 해결된 것부터 뺀다. 빠진 요청도 기록(이벤트)은 남아 있어서, 같은 requestKey의 `open`은 커밋 키로 기록된 요청을
 * 되찾아 저장된 해결을 이어 받는다(`adoptStoredResolution`). 대기 중인 요청과 대기자가 있는 요청은 빼지 않는다
 */
const RESOLVED_KEPT = 256;

/**
 * 파이프라인과 L2 어댑터가 쓰는 확장. 비차단 `open`·`wait`·`get`은 F `ApprovalService`로 올라갔다(L1.tools.spec §8.3 F 요청 11).
 * 여기에 남은 것은 세션 허용 목록 조회뿐이다
 */
export interface ApprovalsInternal extends ApprovalService {
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

function isMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODE_STRICTNESS.some((mode) => mode === value);
}

/** 계획 승인 해결의 `{ mode }`. 없거나 모드가 아니면 undefined */
function planModeOf(
  request: ApprovalRequest,
  resolution: ApprovalResolution,
): PermissionMode | undefined {
  if (request.body.kind !== "plan" || resolution.decision !== "allow") return undefined;
  const mode = isJsonObject(resolution.answer) ? resolution.answer["mode"] : undefined;
  return isMode(mode) ? mode : undefined;
}

function promptKind(request: ApprovalRequest): "confirm" | "select" {
  return request.body.kind === "question" ? "select" : "confirm";
}

function invalidRequest(detail: string): CommitFailure {
  return { kind: "rejected", code: "approvals.request_invalid", detail };
}

export function createApprovalService(deps: ApprovalDeps): ApprovalsInternal {
  const byId = new Map<string, Entry>();
  const byKey = new Map<string, string>();
  const remembered = new Set<string>();
  /** 해결된 요청의 approvalId, 해결된 순서(Set은 넣은 순서를 지킨다). 상한을 넘으면 앞에서부터 표에서 뺀다 */
  const resolvedOrder = new Set<string>();
  const resolvedKept = deps.resolvedKept ?? RESOLVED_KEPT;

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
    const payload = {
      reason: "ui_prompt",
      kind: promptKind(request),
      title: request.title,
    } as const;
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

  /** 해결된 요청이 상한을 넘으면 가장 오래전에 해결된 것을 표에서 뺀다. 대기자가 남은 요청은 빼지 않는다 */
  function evictResolved(): void {
    for (const approvalId of resolvedOrder) {
      if (resolvedOrder.size <= resolvedKept) return;
      const entry = byId.get(approvalId);
      if (entry !== undefined && entry.waiters.size > 0) continue;
      resolvedOrder.delete(approvalId);
      if (entry === undefined) continue;
      byId.delete(approvalId);
      const key = keyOf(entry.request.surfaceThreadId, entry.request.requestKey);
      if (byKey.get(key) === approvalId) byKey.delete(key);
    }
  }

  function settle(entry: Entry, resolution: ApprovalResolution): void {
    entry.state = "resolved";
    entry.resolution = resolution;
    applyRemember(entry, resolution);
    for (const waiter of entry.waiters) waiter(resolution);
    entry.waiters.clear();
    resolvedOrder.add(entry.request.approvalId);
    evictResolved();
  }

  /**
   * 계획 승인이 허용이고 `{ mode }`가 있으면 권한 모드를 바꾼다(L1.tools.spec §4.7 5번). 대기를 풀기 전에 하므로 계획 도구가 이어갈 때 모드가 이미 바뀌어 있다.
   * 같은 모드면 쓰지 않는다: 해결이 이미 커밋된 뒤 재시작해 이 호출이 다시 올 때 중복 기록이 없다. 바꾸지 못해도 해결은 그대로다(경고만 남긴다)
   */
  async function applyPlanMode(
    request: ApprovalRequest,
    resolution: ApprovalResolution,
  ): Promise<void> {
    const mode = planModeOf(request, resolution);
    if (mode === undefined) return;
    const threadId = request.origin.threadId;
    if (deps.modeOf(threadId) === mode) return;
    const changed = await deps.setMode(threadId, mode);
    if (!changed.ok) {
      deps.logger?.warn("tools.plan_mode_not_applied", {
        approvalId: request.approvalId,
        mode,
        reason: changed.error.kind,
      });
    }
  }

  /** approval.resolved 커밋. 성공하면 모드를 적용하고 entry를 해결 상태로 바꾼다 */
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
    await applyPlanMode(request, resolution);
    settle(entry, resolution);
    await prompt(entry, "end");
    return ok(undefined);
  }

  function opened(entry: Entry): OpenedApproval {
    return { request: entry.request, resolution: entry.resolution ?? null };
  }

  /** approval.requested(+ 대기 체크포인트) 한 커밋. 같은 requestKey는 기존 요청을 돌려준다 */
  async function open(input: ApprovalRequestInput): Promise<Result<OpenedApproval, CommitFailure>> {
    const issue = requestIssue(input);
    if (issue !== undefined) return err(invalidRequest(issue));

    const call = deps.callOf(input.origin);
    const surfaceThreadId = call?.run.surfaceThreadId ?? input.origin.threadId;
    const knownId = byKey.get(keyOf(surfaceThreadId, input.requestKey));
    const known = knownId === undefined ? undefined : byId.get(knownId);
    if (known !== undefined) return ok(opened(known));

    const requestedAt = deps.clock.now();
    const sameThread = input.origin.threadId === surfaceThreadId;
    const payload = {
      origin: input.origin,
      requestKey: input.requestKey,
      title: input.title,
      body: input.body,
      remember: input.remember,
      surfaceThreadId,
      requestedAt,
    };
    const shape = parse(ApprovalRequestedPayloadSchema, payload);
    if (!shape.ok) {
      const first = shape.error.issues[0];
      return err(
        invalidRequest(
          first === undefined ? "request payload is invalid" : `${first.path} ${first.message}`,
        ),
      );
    }

    // 비대화형 실행의 요청은 사람이 없다. 요청과 거부 해결을 한 커밋에 남기고 바로 거부한다(§4.7 7번, 감사 기록).
    // 정책의 ask는 비대화형에서 deny로 바뀌어 도구 승인이 나오지 않는 것이 보통이지만, 정책이 허용한 뒤에 파이프라인이 다시 묻는
    // 비밀 사용 승인과 능력 서비스가 올리는 도구 승인(도메인 승인 등)은 정책을 지나지 않는다. 그래서 kind를 가리지 않는다.
    // 턴 밖의 요청(call 없음)은 대화형으로 본다
    const silent = call !== undefined && !call.run.interactive;
    const requestedId = deps.ids.next("evt");
    const requestedDraft = deps.producer.draft({
      id: requestedId,
      kind: "approval.requested",
      threadId: surfaceThreadId,
      turnId: sameThread ? input.origin.turnId : null,
      stepId: sameThread ? input.origin.stepId : null,
      causationId: null,
      correlationId: null,
      payload,
    });
    const drafts: StampedDraft[] = [requestedDraft];
    const silentResolution: ApprovalResolution = {
      approvalId: requestedId,
      decision: "deny",
      answer: null,
      remember: "once",
      requestedRemember: null,
      resolvedBy: "noninteractive",
    };
    if (silent) {
      drafts.push(
        deps.producer.draft({
          id: deps.ids.next("evt"),
          kind: "approval.resolved",
          threadId: surfaceThreadId,
          turnId: sameThread ? input.origin.turnId : null,
          stepId: sameThread ? input.origin.stepId : null,
          causationId: requestedId,
          correlationId: null,
          payload: silentResolution,
        }),
      );
    }

    let checkpoint: StepCheckpointInput | null = null;
    // 서브에이전트 요청은 부모(표면) 대화에 기록되므로 대기 체크포인트를 같은 커밋에 넣을 수 없다(커밋은 한 대화의 것이다).
    // 자식 대화는 재개 때 마지막 단계 체크포인트에서 도구 단계로 들어가 같은 requestKey로 요청하면 기록된 요청을 이어 받는다
    if (call !== undefined && input.origin.toolCallId !== null && !silent && sameThread) {
      const waiting: PendingToolCall = {
        toolCallId: input.origin.toolCallId,
        // 도구 승인은 의도 전에 일어난다. 질문·계획은 도구 실행 안에서 일어나므로 의도가 이미 있다
        effectId: input.body.kind === "tool" ? null : call.effectId,
        waiting: "approval",
      };
      // 대기 체크포인트 내용은 루프가 만든다. 저장소가 같은 커밋에 checkpoint.step으로 붙인다(A1)
      checkpoint = waitingCheckpointInput(call.run.drafts.waitingCheckpoint([waiting]));
    }
    const committed = commitWithRetry(deps.session, {
      threadId: surfaceThreadId,
      requestId: requestCommitKey(surfaceThreadId, input.requestKey),
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
    if (!committed.result.replayed && eventId !== requestedId) {
      throw new Bug("tools.approval_event_id_mismatch: the store did not keep the draft event id");
    }
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
    } else if (silent) {
      settle(entry, silentResolution);
    } else {
      await prompt(entry, "start");
    }
    return ok(opened(entry));
  }

  /** 같은 키의 요청이 이미 커밋되어 있었다면(재시작) 그 사이 응답이 커밋되었는지 이벤트에서 확인한다 */
  async function adoptStoredResolution(entry: Entry): Promise<Result<void, ReadFailure>> {
    const scanned = await scanApprovals(deps.session, entry.request.surfaceThreadId);
    if (!scanned.ok) return scanned;
    const stored = scanned.value.resolved.get(entry.request.approvalId);
    if (stored !== undefined) {
      // 해결은 커밋됐지만 모드 변경 전에 끊겼을 수 있다. 계획 도구가 다시 요청하는 이 자리에서 이어서 적용한다
      await applyPlanMode(entry.request, stored);
      settle(entry, stored);
    }
    return ok(undefined);
  }

  /** 해결이 오면 그 해결, signal이 끊기면 undefined */
  function waitFor(entry: Entry, signal: AbortSignal): Promise<ApprovalResolution | undefined> {
    if (entry.resolution !== undefined) return Promise.resolve(entry.resolution);
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise<ApprovalResolution | undefined>((resolve) => {
      const onAbort = (): void => {
        entry.waiters.delete(waiter);
        resolve(undefined);
      };
      const waiter = (resolution: ApprovalResolution): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(resolution);
      };
      entry.waiters.add(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function requestAndWait(
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, CommitFailure>> {
    const created = await open(input);
    if (!created.ok) return created;
    const entry = byId.get(created.value.request.approvalId);
    if (entry === undefined) throw new Bug("tools.approval_entry_missing");
    // signal이 끊긴 대기는 취소 해결로 돌려주되 커밋하지 않는다. 요청을 닫는 일은 호출자의 몫이다(cancel)
    const resolution = await waitFor(entry, signal);
    return ok(resolution ?? cancelledResolution(entry.request));
  }

  async function wait(
    approvalId: string,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, ApprovalWaitFailure>> {
    const entry = byId.get(approvalId);
    if (entry === undefined) return err({ kind: "unknown" });
    const resolution = await waitFor(entry, signal);
    return resolution === undefined ? err({ kind: "aborted" }) : ok(resolution);
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
    for (const { eventId, request: stored } of scanned.value.requests) {
      if (byId.has(stored.approvalId)) continue;
      const entry = add(eventId, stored);
      const resolved = scanned.value.resolved.get(stored.approvalId);
      if (resolved !== undefined) settle(entry, resolved);
    }
    return ok(pending(threadId));
  }

  return {
    request: requestAndWait,
    open,
    wait,
    get(approvalId) {
      const entry = byId.get(approvalId);
      return entry === undefined ? undefined : opened(entry);
    },
    respond,
    pending,
    restore,
    cancel,
    isRemembered(surfaceThreadId, toolName, ruleId) {
      return remembered.has(rememberKey(surfaceThreadId, toolName, ruleId));
    },
  };
}
