import { assertNever, attemptAsync, type Clock, type Logger } from "@xeon/contracts";
import { CapabilityError } from "@xeon/contracts/capabilities";
import type { IdFactory, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  AgentBeforeSettlePayload,
  BoundaryPatch,
  BoundaryValue,
  HandlerContext,
} from "@xeon/contracts/extensions";
import type { DurableEventDraft } from "@xeon/contracts/records";
import type { AgentService, JudgeInput, JudgeOutcome } from "@xeon/contracts/services";
import { goalGateDecision, type GoalGateDecision } from "@xeon/core-agents";
import { readTasks, type GoalRow } from "../projection/read.ts";
import type { WorkReader } from "../ports/session.ts";
import { criteriaOf, evidenceOf } from "./evidence.ts";
import type { GoalsRuntime, SettleAction } from "./service.ts";

// M3-new-02, D-M3-15, L2.work.spec §4.3. 목표 지속은 `boundary.settle.before` chain 핸들러 하나로 한다. turn이 정착하려 할 때 활성 목표가 있으면
// L1.agents의 `judge`를 부르고 결과를 `goalGateDecision`(L1.agents.spec §4.8)으로 옮긴다.
//   met: 정착한다 / not_met·undecidable: 지시를 남기고 한 단계 더 돈다 / capped: turn을 끝내고 안내 / failed: 판정 없이 계속 돌지 않고 끝낸다(stop).
// 판정 결과는 work.goal_judged·goal_settled·report_built로 자기 커밋에 남기므로 재개 때 같은 판정을 다시 기록하지 않는다.

/** 미달 판정 뒤 모델에 남기는 지시. 한 단계 더 돌 때 대화 기록에 든다 */
export const GOAL_CONTINUE_TYPE = "x.cap-work.goal.continue";
/** 판정이 turn을 끝낸 이유(상한, 판정 실패)를 사용자에게 알리는 안내 */
export const GOAL_NOTICE_TYPE = "x.cap-work.goal.notice";

export interface SettleGateDeps {
  readonly goals: GoalsRuntime;
  readonly reader: WorkReader;
  /** 호출 때마다 얻는다. xeon.agents가 아직 없으면 undefined이고 판정은 실패로 본다 */
  readonly agents: () => Pick<AgentService, "judge"> | undefined;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface SettleGate {
  /** `boundary.step.after`: 정착 직전 단계의 id를 기억한다. 정착 지점 payload에는 단계 id가 없어 엔트리 범위 필드를 맞추려면 필요하다 */
  rememberStep(stepId: StepId, threadId: ThreadId): void;
  settle(
    payload: AgentBeforeSettlePayload,
    current: Readonly<BoundaryValue>,
    ctx: HandlerContext<unknown>,
  ): Promise<BoundaryPatch | undefined>;
}

function actionOf(outcome: JudgeOutcome): SettleAction {
  switch (outcome.kind) {
    case "judged":
    case "recorded":
      return {
        kind: "judged",
        n: outcome.record.run,
        verdict: {
          met: outcome.record.verdict === "met",
          reason: outcome.record.rationale,
          missing: outcome.record.missing,
        },
        usage: outcome.kind === "judged" ? outcome.record.usage : null,
      };
    case "capped":
      return { kind: "capped" };
    case "failed":
      return { kind: "failed", message: outcome.message };
    default:
      return assertNever(outcome, "JudgeOutcome");
  }
}

export function createSettleGate(deps: SettleGateDeps): SettleGate {
  const lastStep = new Map<ThreadId, StepId>();

  function customEntry(
    threadId: ThreadId,
    turnId: TurnId,
    stepId: StepId,
    customType: string,
    text: string,
  ): DurableEventDraft {
    return {
      id: deps.ids.next("evt"),
      kind: "item.recorded",
      version: 1,
      threadId,
      turnId,
      stepId,
      causationId: null,
      correlationId: null,
      durable: true,
      payload: {
        item: {
          itemId: deps.ids.next("itm"),
          status: "completed",
          kind: "custom",
          message: {
            role: "custom",
            customType,
            content: text,
            display: true,
            details: null,
            timestamp: deps.clock.now(),
          },
        },
      },
    };
  }

  async function judgeFor(
    threadId: ThreadId,
    turnId: TurnId,
    row: GoalRow,
    payload: AgentBeforeSettlePayload,
    signal: AbortSignal,
  ): Promise<JudgeOutcome> {
    const agents = deps.agents();
    if (agents === undefined) return { kind: "failed", message: "xeon.agents is not available" };
    const tasks = readTasks(deps.reader, threadId);
    const previous = deps.goals.judgments(threadId, row.goal.goalId);
    if (!tasks.ok || !previous.ok) {
      return { kind: "failed", message: "the goal evidence could not be read" };
    }
    const input: JudgeInput = {
      threadId,
      turnId,
      goalRef: row.goal.goalId,
      goal: { text: row.goal.condition, criteria: criteriaOf(row.goal) },
      evidence: evidenceOf({
        messages: payload.context.contextMessages,
        tasks: tasks.value,
        previous: previous.value,
      }),
    };
    if (signal.aborted) return { kind: "failed", message: "the turn was aborted" };
    const judged = await attemptAsync(() => agents.judge(input));
    if (judged.ok) return judged.value;
    const cause = judged.error.cause;
    return {
      kind: "failed",
      message: cause instanceof Error ? cause.message : "the judge call threw",
    };
  }

  /** 판정이 상한 때문에 목표를 끝냈으면(미달인데 마지막 실행) turn도 끝낸다 */
  function finalDecision(
    decision: GoalGateDecision,
    goalStatus: string,
    threadId: ThreadId,
  ): GoalGateDecision {
    if (decision.continue && goalStatus === "limit_reached") {
      return {
        continue: false,
        reason: "capped",
        instruction: null,
        notice: `The goal judge reached its limit of ${String(deps.goals.maxRuns(threadId))} runs, so the turn ended without meeting the goal.`,
      };
    }
    return decision;
  }

  return {
    rememberStep(stepId, threadId) {
      lastStep.set(threadId, stepId);
    },

    async settle(payload, current, ctx) {
      // 사용자가 끊은 turn은 다음 단계를 원하지 않는다는 뜻이라 판정하지 않는다. 실패한 turn은 계속할 수 없어 판정하지 않는다 [제안]
      if (payload.outcome !== "completed") return undefined;
      const active = deps.goals.activeGoal(ctx.threadId);
      if (!active.ok) {
        deps.logger.warn("work.goal_gate.unreadable", { thread: ctx.threadId });
        return undefined;
      }
      const row = active.value;
      // 위임 판정자의 목표는 `work.goals.judge`로 판정이 들어온다. 이 지점은 모델 판정자의 목표만 다룬다
      if (row === undefined || row.goal.judge.kind !== "model") return undefined;

      const outcome = await judgeFor(ctx.threadId, payload.turnId, row, payload, ctx.signal);
      if (ctx.signal.aborted) return undefined;
      const decision = goalGateDecision(outcome);

      const recorded = await attemptAsync(() =>
        deps.goals.settleTurn(ctx.threadId, payload.turnId, row.goal.goalId, actionOf(outcome)),
      );
      if (!recorded.ok) {
        const cause = recorded.error.cause;
        deps.logger.error("work.goal_gate.record_failed", {
          thread: ctx.threadId,
          goal: row.goal.goalId,
          code: cause instanceof CapabilityError ? cause.data.code : "threw",
        });
        // 기록하지 못하면 판정 없이 계속 돌지 않는다(stop). 재개 때 같은 판정이 다시 기록된다
        return { continue: false };
      }
      // 판정하는 동안 목표가 지워졌거나 끝났다. 끼어들지 않는다
      if (recorded.value.kind === "skipped") return undefined;

      const final = finalDecision(decision, recorded.value.goal.status, ctx.threadId);
      if (!final.continue && final.notice === null) return undefined;
      const text = final.instruction ?? final.notice;
      const stepId = lastStep.get(ctx.threadId);
      const entries = [...current.entries];
      if (text !== null && stepId !== undefined) {
        const type = final.instruction === null ? GOAL_NOTICE_TYPE : GOAL_CONTINUE_TYPE;
        entries.push(customEntry(ctx.threadId, payload.turnId, stepId, type, text));
      } else if (text !== null) {
        deps.logger.warn("work.goal_gate.no_step", { thread: ctx.threadId });
      }
      lastStep.delete(ctx.threadId);
      return { entries, continue: final.continue };
    },
  };
}
