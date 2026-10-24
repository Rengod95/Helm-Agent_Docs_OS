import { assertNever, eachAsync, parse, type Result } from "@xeon/contracts";
import {
  WorkPlans,
  type CapabilityApi,
  type PlanId,
  type PlanSubmitResult,
  type PlanVersion,
} from "@xeon/contracts/capabilities";
import {
  toJsonValue,
  ThreadIdSchema,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import {
  ApprovalResolvedPayloadSchema,
  WorkPlanSubmittedSchema,
  type CommitPlan,
  type CommitResult,
  type DurableEventEnvelope,
  type ReadFailure,
  type StampedDraft,
  type StoreError,
} from "@xeon/contracts/records";
import type {
  ApprovalOrigin,
  CallerId,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
  PermissionMode,
} from "@xeon/contracts/services";
import {
  commitKeyOf,
  orThrow as orThrowIn,
  requestIdOf,
  scopeOf,
  type CallScope,
} from "../call.ts";
import type { WorkPlansDeps } from "../deps.ts";
import { internalError, planRejection, storeRejection } from "../errors.ts";
import {
  approvalRequestId,
  nextModesFor,
  PLAN_ANSWER_JSON_SCHEMA,
  planSubject,
} from "../ports/approvals.ts";
import type { ModeFailure, PermissionModePort } from "../ports/permission-mode.ts";
import {
  readModeMeta,
  readPlanByApproval,
  readPlans,
  type ModeMeta,
  type PlanRow,
} from "../projection/read.ts";
import { createThreadQueue } from "../tasks/queue.ts";
import { outcomeOf } from "./decision.ts";
import { decodePlanFailure, encodePlanFailure } from "./failure.ts";
import { permissionModeOf, plansSinceEntry, submitTarget, type SubmitTarget } from "./model.ts";
import { planRefOf } from "./refs.ts";

// L2.work.spec §3.3, §4.2. work.plans 서비스. 계획 객체와 버전은 work.plan_* 이벤트가 정본이고, 결정(승인·반려·수정 요청)은
// L1.tools의 approval.resolved 하나로 남는다. 투영기가 그 이벤트에서 계획 상태를 계산한다(spec §3.7).

const CAPABILITY = WorkPlans.id;

export interface PlansRuntime {
  readonly api: CapabilityApi<typeof WorkPlans>;
  /** approval.resolved 한 건을 받아 승인된 계획이면 계획 모드를 나간다(spec §4.2.5). 피드 구독자가 부른다 */
  onApprovalResolved(event: DurableEventEnvelope): Promise<void>;
  /** 스레드를 다시 열 때 승인 요청이 빠진 판을 다시 요청하고 모드 복원을 마무리한다(spec §4.5) */
  resume(threadId: ThreadId): Promise<void>;
  /** 승인 대기 중인 가장 최근 판. `/plan approve`처럼 계획 ID 없이 부르는 명령이 쓴다 */
  pendingPlan(threadId: ThreadId): PlanVersion | undefined;
}

function toPlanVersion(row: PlanRow): PlanVersion {
  return {
    planId: row.planId,
    version: row.version,
    title: row.title,
    body: row.body,
    status: row.status,
    artifact: row.artifact,
    approvalId: row.approvalId,
    feedback: row.feedback,
  };
}

function callerIdOf(scope: CallScope): CallerId {
  const caller = scope.context?.caller;
  return caller?.agent === "subagent" ? `subagent:${caller.extension ?? "agent"}` : "main";
}

function originOf(scope: CallScope): ApprovalOrigin {
  return {
    threadId: scope.threadId,
    turnId: scope.turnId,
    stepId: null,
    toolCallId: scope.context?.toolCallId ?? null,
    caller: callerIdOf(scope),
  };
}

/** 스레드를 다시 열 때처럼 호출 문맥이 없는 곳의 범위 */
function systemScope(threadId: ThreadId): CallScope {
  return { threadId, turnId: null, context: undefined, signal: undefined };
}

/** 큐 안에서 마친 제출: 계획 한 판, 그 판의 승인 포트, 승인 요청의 현재 상태 */
interface Submitted {
  readonly row: PlanRow;
  readonly port: L2ApprovalsPort;
  readonly snapshot: L2ApprovalSnapshot;
}

const CANCELLED_FEEDBACK = "The approval request was cancelled.";

function orThrow<T>(method: string, read: Result<T, ReadFailure | StoreError>): T {
  return orThrowIn(CAPABILITY, method, read);
}

function modeRejection(method: string, failure: ModeFailure): Error {
  switch (failure.kind) {
    case "mode_forbidden":
      return planRejection(CAPABILITY, method, { kind: "mode_forbidden", mode: failure.mode });
    case "commit_failed":
      return storeRejection(CAPABILITY, method, failure.store);
    default:
      return assertNever(failure, "modeRejection");
  }
}

function decidedOf(row: PlanRow, snapshot: L2ApprovalSnapshot): PlanSubmitResult {
  if (snapshot.state === "pending") {
    return {
      status: "input_required",
      planId: row.planId,
      version: row.version,
      approvalId: snapshot.approvalId,
    };
  }
  if (snapshot.state === "cancelled" || snapshot.resolution === null) {
    return {
      status: "decided",
      planId: row.planId,
      version: row.version,
      approvalId: snapshot.approvalId,
      decision: "rejected",
      feedback: CANCELLED_FEEDBACK,
    };
  }
  const outcome = outcomeOf(snapshot.resolution.decision, snapshot.resolution.answer, "user");
  return {
    status: "decided",
    planId: row.planId,
    version: row.version,
    approvalId: snapshot.approvalId,
    decision: outcome.kind === "decided" ? outcome.decision : "rejected",
    feedback: outcome.kind === "decided" ? outcome.feedback : CANCELLED_FEEDBACK,
  };
}

/** 대기 중이면 결정이 날 때까지 기다린다. 쓰기 큐 밖에서 부른다: 큐를 쥔 채 기다리면 같은 계획의 approve·reject가 막힌다 */
async function finishSubmit(
  scope: CallScope,
  wait: boolean,
  submitted: Submitted,
): Promise<PlanSubmitResult> {
  const { row, port, snapshot } = submitted;
  if (snapshot.state === "pending" && wait) {
    const waited = await port.wait(
      scope.threadId,
      snapshot.approvalId,
      scope.signal ?? new AbortController().signal,
    );
    if (!waited.ok) {
      throw planRejection(CAPABILITY, "submit", {
        kind: "unavailable",
        message: "The wait for the decision was cancelled.",
      });
    }
    return decidedOf(row, waited.value);
  }
  return decidedOf(row, snapshot);
}

export function createPlans(deps: WorkPlansDeps): PlansRuntime {
  const queue = createThreadQueue();
  /** 이 프로세스가 계획 모드에 넣은 스레드의 직전 모드. 재시작 뒤에는 투영의 값(세션 범위 이력)을 쓴다 */
  const remembered = new Map<ThreadId, PermissionMode>();

  function modePort(method: string): PermissionModePort {
    if (deps.mode === undefined) {
      throw planRejection(CAPABILITY, method, {
        kind: "unavailable",
        message: "The permission mode service is not available.",
      });
    }
    return deps.mode;
  }

  function approvalsFor(method: string, scope: CallScope): L2ApprovalsPort {
    if (deps.approvals === undefined) {
      throw planRejection(CAPABILITY, method, {
        kind: "unavailable",
        message: "The approval service is not available.",
      });
    }
    return deps.approvals(originOf(scope));
  }

  function previousModeOf(threadId: ThreadId, meta: ModeMeta): PermissionMode | null {
    return remembered.get(threadId) ?? permissionModeOf(meta.modeBeforePlan) ?? null;
  }

  function draftOf(
    scope: CallScope,
    kind: "work.plan_submitted" | "work.plan_withdrawn",
    payload: unknown,
  ): StampedDraft {
    return deps.producer.draft({
      id: deps.ids.next("evt"),
      kind,
      threadId: scope.threadId,
      turnId: scope.turnId,
      stepId: null,
      causationId: null,
      correlationId: null,
      payload,
    });
  }

  function commitPlans(
    method: string,
    scope: CallScope,
    requestId: string,
    fingerprint: JsonValue,
    build: () => CommitPlan,
  ): Extract<CommitResult, { status: "committed" | "rejected" }> {
    const committed = deps.session.commit({
      threadId: scope.threadId,
      requestId: commitKeyOf("plans", requestId),
      fingerprintSource: fingerprint,
      build,
    });
    if (!committed.ok) throw storeRejection(CAPABILITY, method, committed.error);
    const result = committed.value;
    if (result.status === "key_reused") {
      deps.logger.error("work.plans.key_reused", { method, requestId });
      throw internalError(
        CAPABILITY,
        method,
        "The requestId was already used with a different input.",
      );
    }
    return result;
  }

  /**
   * 이 requestId의 커밋이 이미 있는지 본다. 롤백되는 빈 커밋으로 묻는다: 키가 있으면 저장소가 build 없이 처음 결과를 돌려주고,
   * 없으면 build가 부르는 abort가 아무것도 남기지 않는다. 산출물 등록처럼 커밋 앞의 부수 효과가 재시도에서 중복되지 않게 한다
   */
  function commitKeyExists(
    method: string,
    scope: CallScope,
    requestId: string,
    fingerprint: JsonValue,
  ): boolean {
    const probe = deps.session.commit({
      threadId: scope.threadId,
      requestId: commitKeyOf("plans", requestId),
      fingerprintSource: fingerprint,
      build: () => ({ kind: "abort", error: { kind: "row_invalid", where: PROBE_MARKER } }),
    });
    if (probe.ok) return true;
    if (probe.error.kind === "row_invalid" && probe.error.where === PROBE_MARKER) return false;
    throw storeRejection(CAPABILITY, method, probe.error);
  }

  function submittedRef(
    method: string,
    threadId: ThreadId,
    committed: Extract<CommitResult, { status: "committed" }>,
  ): { planId: PlanId; version: number } {
    const span = committed.lastSeq - committed.firstSeq + 1;
    const read = deps.session.feed.read(
      committed.firstSeq - 1,
      committed.lastSeq,
      { threadIds: [threadId], kindPrefixes: ["work.plan_submitted"] },
      span,
      span,
    );
    const first = orThrow(method, read).events[0];
    const payload = first === undefined ? undefined : parse(WorkPlanSubmittedSchema, first.payload);
    if (payload === undefined || !payload.ok) {
      throw internalError(
        CAPABILITY,
        method,
        "The stored work.plan_submitted event is missing or damaged.",
      );
    }
    return { planId: payload.value.planId, version: payload.value.version };
  }

  /** 계획 한 판의 승인 요청을 보장한다. 이미 있으면 현재 상태를, 없으면 새로 요청한다(같은 키라 중복이 없다) */
  async function ensureApproval(
    method: string,
    scope: CallScope,
    row: PlanRow,
    meta: ModeMeta,
  ): Promise<{ readonly port: L2ApprovalsPort; readonly snapshot: L2ApprovalSnapshot }> {
    const port = approvalsFor(method, scope);
    if (row.approvalId !== null) {
      const known = port.get(scope.threadId, row.approvalId);
      const snapshot = orThrow(method, await known);
      if (snapshot !== null) return { port, snapshot };
    }
    const requested = await port.request({
      threadId: scope.threadId,
      kind: "plan",
      subject: planSubject(row, nextModesFor(previousModeOf(scope.threadId, meta))),
      answerSchema: PLAN_ANSWER_JSON_SCHEMA,
      requestId: planRefOf(row.planId, row.version),
    });
    if (requested.ok) return { port, snapshot: requested.value };
    switch (requested.error.kind) {
      case "store":
        throw storeRejection(CAPABILITY, method, requested.error.error);
      case "rejected":
        throw internalError(
          CAPABILITY,
          method,
          `The approval request was rejected (${requested.error.code}).`,
        );
      case "key_reused":
        throw internalError(
          CAPABILITY,
          method,
          "The approval request key was reused with a different plan.",
        );
      default:
        return assertNever(requested.error, "ensureApproval");
    }
  }

  async function registerArtifact(
    scope: CallScope,
    target: SubmitTarget,
    title: string,
    body: string,
  ): Promise<PlanVersion["artifact"]> {
    const port = deps.artifacts;
    if (port === undefined) return null;
    const input = {
      threadId: scope.threadId,
      title,
      body,
      requestId: planRefOf(target.planId, target.version),
      meta: { planId: target.planId, planVersion: target.version },
    };
    const registered =
      target.artifactId === null
        ? await port.register(input)
        : await port.update({ ...input, artifactId: target.artifactId });
    if (registered.ok) return registered.value;
    deps.logger.warn("work.plans.artifact_failed", {
      thread: scope.threadId,
      plan: target.planId,
      reason: registered.error.message,
    });
    return null;
  }

  async function submitInQueue(
    scope: CallScope,
    requestId: string,
    input: { title: string; body: string; planId?: string },
  ): Promise<Submitted> {
    const method = "submit";
    // 승인을 받을 수 없는 조립이면 계획을 기록하기 전에 거부한다
    approvalsFor(method, scope);
    const plans = orThrow(method, readPlans(deps.reader, scope.threadId));
    const meta = orThrow(method, readModeMeta(deps.reader, scope.threadId));
    const fingerprint = toJsonValue({
      method,
      title: input.title,
      body: input.body,
      planId: input.planId ?? null,
    });
    if (fingerprint === undefined) {
      throw planRejection(CAPABILITY, method, {
        kind: "invalid_input",
        message: "The plan is not plain JSON.",
      });
    }
    const target = submitTarget(plans, input.planId);
    let artifact: PlanVersion["artifact"] = null;
    if (
      target.ok &&
      deps.artifacts !== undefined &&
      !commitKeyExists(method, scope, requestId, fingerprint)
    ) {
      artifact = await registerArtifact(scope, target.value, input.title, input.body);
    }
    const result = commitPlans(method, scope, requestId, fingerprint, () => {
      if (!target.ok) {
        return { kind: "reject", code: target.error.kind, detail: encodePlanFailure(target.error) };
      }
      return {
        kind: "append",
        drafts: [
          draftOf(scope, "work.plan_submitted", {
            planId: target.value.planId,
            version: target.value.version,
            title: input.title,
            body: input.body,
            artifact,
            supersedes: target.value.supersedes,
          }),
        ],
        checkpoint: null,
      };
    });
    let ref: { planId: PlanId; version: number };
    if (result.status === "rejected") {
      const stored = decodePlanFailure(result.detail);
      if (stored === undefined)
        throw internalError(CAPABILITY, method, "A stored rejection is damaged.");
      throw planRejection(CAPABILITY, method, stored);
    } else if (!result.replayed && target.ok) {
      ref = { planId: target.value.planId, version: target.value.version };
    } else {
      ref = submittedRef(method, scope.threadId, result);
    }
    const afterCommit = orThrow(method, readPlans(deps.reader, scope.threadId));
    const row = afterCommit.find(
      (plan) => plan.planId === ref.planId && plan.version === ref.version,
    );
    if (row === undefined)
      throw internalError(CAPABILITY, method, "The submitted plan is missing from the projection.");

    const { port, snapshot } = await ensureApproval(method, scope, row, meta);
    return { row, port, snapshot };
  }

  async function decide(
    method: "approve" | "reject" | "revise",
    scope: CallScope,
    requestId: string,
    input: { planId: string; version?: number },
    response: { decision: "allow" | "deny" | "answer"; answer?: JsonValue },
  ): Promise<{ plan: PlanVersion }> {
    const plans = orThrow(method, readPlans(deps.reader, scope.threadId));
    const meta = orThrow(method, readModeMeta(deps.reader, scope.threadId));
    const versions = plans.filter((plan) => plan.planId === input.planId);
    const row =
      input.version === undefined
        ? versions[versions.length - 1]
        : versions.find((plan) => plan.version === input.version);
    if (row === undefined) {
      throw planRejection(CAPABILITY, method, { kind: "not_found", id: input.planId });
    }
    if (row.status !== "submitted") {
      throw planRejection(CAPABILITY, method, { kind: "plan_closed", status: row.status });
    }
    const { port, snapshot } = await ensureApproval(method, scope, row, meta);
    if (snapshot.state !== "pending") {
      const settled = orThrow(method, readPlans(deps.reader, scope.threadId)).find(
        (plan) => plan.planId === row.planId && plan.version === row.version,
      );
      throw planRejection(CAPABILITY, method, {
        kind: "plan_closed",
        status: settled?.status ?? row.status,
      });
    }
    const applied = await port.respond({
      threadId: scope.threadId,
      approvalId: snapshot.approvalId,
      decision: response.decision,
      ...(response.answer === undefined ? {} : { answer: response.answer }),
      requestId: approvalRequestId(requestId),
    });
    const after = orThrow(method, readPlans(deps.reader, scope.threadId)).find(
      (plan) => plan.planId === row.planId && plan.version === row.version,
    );
    if (after === undefined)
      throw internalError(CAPABILITY, method, "The plan is missing after the decision.");
    if (!applied.applied) {
      throw planRejection(CAPABILITY, method, { kind: "plan_closed", status: after.status });
    }
    return { plan: toPlanVersion(after) };
  }

  async function restoreAfterApproval(threadId: ThreadId, plan: PlanRow): Promise<void> {
    const method = "restore";
    const port = deps.mode;
    if (port === undefined || plan.status !== "approved") return;
    if (!deps.settings(threadId).plans.exitOnApprove) return;
    if (port.current(threadId) !== "plan") return;
    const meta = orThrow(method, readModeMeta(deps.reader, threadId));
    if (plan.submittedSeq <= (meta.planEnteredSeq ?? 0)) return;
    const target = previousModeOf(threadId, meta) ?? "default";
    const restored = await port.restore(threadId, target, "plan_approval");
    if (!restored.ok) throw modeRejection(method, restored.error);
    remembered.delete(threadId);
  }

  const api: CapabilityApi<typeof WorkPlans> = {
    async enterMode(_input, options) {
      const scope = scopeOf(CAPABILITY, "enterMode", options);
      requestIdOf(CAPABILITY, "enterMode", options);
      return await queue.run(scope.threadId, async () => {
        const entered = await modePort("enterMode").enterPlan(scope.threadId);
        if (!entered.ok) throw modeRejection("enterMode", entered.error);
        if (entered.value.previousMode !== null) {
          remembered.set(scope.threadId, entered.value.previousMode);
        }
        const meta = orThrow("enterMode", readModeMeta(deps.reader, scope.threadId));
        const previous = entered.value.previousMode ?? previousModeOf(scope.threadId, meta);
        return { mode: "plan", previousMode: previous };
      });
    },

    async exitMode(_input, options) {
      const scope = scopeOf(CAPABILITY, "exitMode", options);
      const requestId = requestIdOf(CAPABILITY, "exitMode", options);
      return await queue.run(scope.threadId, async () => {
        const port = modePort("exitMode");
        if (port.current(scope.threadId) !== "plan") {
          throw planRejection(CAPABILITY, "exitMode", { kind: "plan_mode_inactive" });
        }
        const plans = orThrow("exitMode", readPlans(deps.reader, scope.threadId));
        const meta = orThrow("exitMode", readModeMeta(deps.reader, scope.threadId));
        const since = plansSinceEntry(plans, meta.planEnteredSeq);
        if (deps.settings(scope.threadId).plans.requireApproval) {
          if (since[since.length - 1]?.status !== "approved") {
            throw planRejection(CAPABILITY, "exitMode", { kind: "plan_not_approved" });
          }
        } else {
          await withdrawPending(scope, requestId, since);
        }
        const target = previousModeOf(scope.threadId, meta) ?? "default";
        const restored = await port.restore(scope.threadId, target, "user");
        if (!restored.ok) throw modeRejection("exitMode", restored.error);
        remembered.delete(scope.threadId);
        return { mode: restored.value.mode, previousMode: "plan" };
      });
    },

    async submit(input, options) {
      const scope = scopeOf(CAPABILITY, "submit", options);
      const requestId = requestIdOf(CAPABILITY, "submit", options);
      const submitted = await queue.run(scope.threadId, () =>
        submitInQueue(scope, requestId, input),
      );
      return await finishSubmit(scope, input.wait === true, submitted);
    },

    async approve(input, options) {
      const scope = scopeOf(CAPABILITY, "approve", options);
      const requestId = requestIdOf(CAPABILITY, "approve", options);
      const answer: JsonValue | undefined =
        input.note === undefined ? undefined : { note: input.note };
      return await queue.run(scope.threadId, () =>
        decide("approve", scope, requestId, input, {
          decision: "allow",
          ...(answer === undefined ? {} : { answer }),
        }),
      );
    },

    async reject(input, options) {
      const scope = scopeOf(CAPABILITY, "reject", options);
      const requestId = requestIdOf(CAPABILITY, "reject", options);
      const answer: JsonValue | undefined =
        input.reason === undefined ? undefined : { feedback: input.reason };
      return await queue.run(scope.threadId, () =>
        decide("reject", scope, requestId, input, {
          decision: "deny",
          ...(answer === undefined ? {} : { answer }),
        }),
      );
    },

    async revise(input, options) {
      const scope = scopeOf(CAPABILITY, "revise", options);
      const requestId = requestIdOf(CAPABILITY, "revise", options);
      return await queue.run(scope.threadId, () =>
        decide("revise", scope, requestId, input, {
          decision: "answer",
          answer: { action: "revise", feedback: input.feedback },
        }),
      );
    },

    async versions(input, options) {
      const scope = scopeOf(CAPABILITY, "versions", options);
      return await queue.run(scope.threadId, () => {
        const plans = orThrow("versions", readPlans(deps.reader, scope.threadId));
        const versions = plans.filter((plan) => plan.planId === input.planId).map(toPlanVersion);
        if (versions.length === 0) {
          throw planRejection(CAPABILITY, "versions", { kind: "not_found", id: input.planId });
        }
        return { versions };
      });
    },
  };

  /** 승인 필수가 아닌 설정에서 계획 모드를 나갈 때 대기 중인 판을 철회한다. 승인 요청을 먼저 닫는다(spec §4.2.5) */
  async function withdrawPending(
    scope: CallScope,
    requestId: string,
    since: readonly PlanRow[],
  ): Promise<void> {
    const pending = since.filter((plan) => plan.status === "submitted");
    if (pending.length === 0) return;
    if (deps.approvals !== undefined) {
      const port = deps.approvals(originOf(scope));
      await eachAsync(pending, async (plan) => {
        if (plan.approvalId !== null) {
          await port.cancel(scope.threadId, plan.approvalId, "plan mode ended");
        }
        return undefined;
      });
    }
    const result = commitPlans("exitMode", scope, requestId, { method: "exitMode" }, () => ({
      kind: "append",
      drafts: pending.map((plan) =>
        draftOf(scope, "work.plan_withdrawn", {
          planId: plan.planId,
          version: plan.version,
          reason: "exit_mode",
        }),
      ),
      checkpoint: null,
    }));
    if (result.status === "rejected") {
      throw internalError(CAPABILITY, "exitMode", `The withdrawal was rejected (${result.code}).`);
    }
  }

  async function onApprovalResolved(event: DurableEventEnvelope): Promise<void> {
    const resolved = parse(ApprovalResolvedPayloadSchema, event.payload);
    if (!resolved.ok || resolved.value.decision !== "allow") return;
    const found = orThrowIn(
      CAPABILITY,
      "onApprovalResolved",
      readPlanByApproval(deps.reader, resolved.value.approvalId),
    );
    if (found === undefined) return;
    const threadId = parse(ThreadIdSchema, found.threadId);
    if (!threadId.ok) return;
    await restoreAfterApproval(threadId.value, found.plan);
  }

  async function resume(threadId: ThreadId): Promise<void> {
    const scope = systemScope(threadId);
    const plans = orThrow("resume", readPlans(deps.reader, threadId));
    const meta = orThrow("resume", readModeMeta(deps.reader, threadId));
    if (deps.approvals !== undefined) {
      await eachAsync(plans, async (plan) => {
        if (plan.status === "submitted" && plan.approvalId === null) {
          await ensureApproval("resume", scope, plan, meta);
        }
        return undefined;
      });
    }
    const latest = plansSinceEntry(plans, meta.planEnteredSeq).at(-1);
    if (latest !== undefined) await restoreAfterApproval(threadId, latest);
  }

  function pendingPlan(threadId: ThreadId): PlanVersion | undefined {
    const plans = readPlans(deps.reader, threadId);
    if (!plans.ok) return undefined;
    const pending = plans.value.findLast((plan) => plan.status === "submitted");
    return pending === undefined ? undefined : toPlanVersion(pending);
  }

  return { api, onApprovalResolved, resume, pendingPlan };
}

/** commitKeyExists가 롤백하는 빈 커밋을 구별하는 표지 */
const PROBE_MARKER = "work.plans.probe";
