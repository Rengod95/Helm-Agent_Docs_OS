import type {
  ArtifactRef,
  PlanStatus,
  ReportId,
  ReportOutcome,
  ReportSubject,
  ReportUsage,
  WorkReport,
  WorkTask,
} from "@xeon/contracts/capabilities";
import type { Usage } from "@xeon/contracts/conversation";
import type { JudgmentRow, PlanRow } from "../projection/read.ts";

// L2.work.spec §3.5, §4.4. 완료 보고는 이벤트에서 계산하는 순수 함수의 결과다. 모델을 부르지 않는다.

const MAX_SUMMARY_CHARS = 4000;
const MAX_REMAINING_TASKS = 100;

const ZERO_USAGE: ReportUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

/** 대화 기록의 Usage를 보고의 사용량으로 옮긴다. 비용은 provider가 알려 준 합계다 */
export function reportUsageOf(usage: Usage): ReportUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
}

/** 사용량을 더한다. 비용은 둘 다 알 때만 더하고 한쪽만 알면 아는 쪽을 쓴다 */
function addUsage(a: ReportUsage, b: ReportUsage | null): ReportUsage {
  if (b === null) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd:
      a.costUsd === null ? b.costUsd : b.costUsd === null ? a.costUsd : a.costUsd + b.costUsd,
  };
}

/** 대상 범위의 완료된 turn 하나 */
export interface TurnFact {
  /** `turn.completed` 이벤트의 seq */
  readonly seq: number;
  readonly turnId: string;
  readonly status: "completed" | "interrupted" | "failed";
  readonly usage: Usage | null;
  readonly recordedAt: number;
}

export interface ReportFacts {
  readonly reportId: ReportId;
  readonly subject: ReportSubject;
  readonly outcome: ReportOutcome;
  /** 호출자가 준 요약. 없으면 reason과 finalText로 만든다 */
  readonly summary: string | undefined;
  /** 마지막 판정의 reason(목표) */
  readonly reason: string | undefined;
  /** 대상 turn의 최종 텍스트 앞부분 */
  readonly finalText: string | undefined;
  readonly turns: readonly TurnFact[];
  readonly judgments: readonly JudgmentRow[];
  /** 범위 시작과 끝의 recordedAt. 알 수 없으면 null */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly tasks: readonly WorkTask[];
  readonly missing: readonly string[];
  readonly artifacts: readonly ArtifactRef[];
  readonly plans: readonly PlanRow[];
  /** 이 seq 뒤에 결정된 계획만 본다(범위 시작) */
  readonly planAfterSeq: number;
}

/** 4,000자 이하의 요약. 호출자 값이 있으면 그대로, 없으면 판정 이유와 최종 텍스트를 이어 붙인다(spec §4.4 3항) */
function summaryOf(facts: Pick<ReportFacts, "summary" | "reason" | "finalText">): string {
  if (facts.summary !== undefined) return facts.summary.slice(0, MAX_SUMMARY_CHARS);
  const parts = [facts.reason, facts.finalText].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.join("\n\n").slice(0, MAX_SUMMARY_CHARS);
}

function lastDecidedPlan(
  plans: readonly PlanRow[],
  afterSeq: number,
): { planId: PlanRow["planId"]; version: number; status: PlanStatus } | null {
  let latest: PlanRow | undefined;
  for (const plan of plans) {
    const decided =
      plan.status === "approved" ||
      plan.status === "rejected" ||
      plan.status === "revision_requested";
    if (!decided || plan.decidedSeq === null || plan.decidedSeq <= afterSeq) continue;
    if (latest === undefined || (latest.decidedSeq ?? 0) < plan.decidedSeq) latest = plan;
  }
  return latest === undefined
    ? null
    : { planId: latest.planId, version: latest.version, status: latest.status };
}

/** 보고를 만든다. 순수 함수다 */
export function composeReport(facts: ReportFacts): WorkReport {
  const agent = facts.turns.reduce<ReportUsage>(
    (sum, turn) => addUsage(sum, turn.usage === null ? null : reportUsageOf(turn.usage)),
    ZERO_USAGE,
  );
  const judge = facts.judgments.reduce<ReportUsage>(
    (sum, row) => addUsage(sum, row.usage),
    ZERO_USAGE,
  );
  const durationMs =
    facts.startedAt === null || facts.endedAt === null
      ? 0
      : Math.max(0, facts.endedAt - facts.startedAt);
  return {
    reportId: facts.reportId,
    subject: facts.subject,
    outcome: facts.outcome,
    summary: summaryOf(facts),
    resources: {
      agent,
      judge,
      turns: facts.turns.length,
      judgments: facts.judgments.length,
      durationMs,
    },
    remaining: {
      tasks: facts.tasks
        .filter(
          (task) =>
            task.status === "pending" || task.status === "in_progress" || task.status === "failed",
        )
        .slice(0, MAX_REMAINING_TASKS)
        .map((task) => ({ id: task.id, content: task.content, status: task.status })),
      missing: facts.missing.slice(0, 20),
    },
    artifacts: facts.artifacts.slice(0, 100),
    plan: lastDecidedPlan(facts.plans, facts.planAfterSeq),
  };
}
