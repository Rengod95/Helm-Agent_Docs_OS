import { assertNever, err, ok, parse, type Clock, type Result } from "@xeon/contracts";
import {
  GoalIdSchema,
  ReportIdSchema,
  WorkGoals,
  WorkReports,
  type CapabilityApi,
  type CapabilityId,
  type Goal,
  type GoalId,
  type GoalJudgeInputValue,
  type GoalJudgeOutputValue,
  type GoalJudgment,
  type GoalRefInput,
  type GoalSetInputValue,
  type GoalStatus,
  type GoalStatusOutputValue,
  type ReportBuildInputValue,
  type ReportId,
  type ReportOutcome,
  type WorkReport,
} from "@xeon/contracts/capabilities";
import {
  TurnCompletedPayloadSchema,
  toJsonValue,
  type ThreadId,
  type TurnId,
  type Usage,
} from "@xeon/contracts/conversation";
import {
  ItemRecordedPayloadSchema,
  WorkGoalJudgedSchema,
  WorkGoalSetSchema,
  WorkGoalSettledSchema,
  WorkReportBuiltSchema,
  type CommitPlan,
  type CommitResult,
  type DurableEventEnvelope,
  type ReadFailure,
  type StampedDraft,
  type WorkGoalJudgedPayload,
  type WorkGoalSetPayload,
  type WorkGoalSettledPayload,
  type WorkReportBuiltPayload,
} from "@xeon/contracts/records";
import {
  commitKeyOf,
  orThrow as orThrowIn,
  requestIdOf,
  scopeOf,
  type CallScope,
} from "../call.ts";
import type { WorkTasksDeps } from "../deps.ts";
import { goalRejection, internalError, storeRejection } from "../errors.ts";
import {
  readGoals,
  readJudgments,
  readPlans,
  readReports,
  readTasks,
  type GoalRow,
  type JudgmentRow,
} from "../projection/read.ts";
import { createThreadQueue } from "../tasks/queue.ts";
import { decodeGoalFailure, encodeGoalFailure, type GoalFailure } from "./failure.ts";
import { composeReport, reportUsageOf, type ReportFacts, type TurnFact } from "./report.ts";

// L2.work.spec §3.4, §3.5, §4.3, §4.4. work.goals와 work.reports 서비스. 쓰기는 스레드마다 직렬화하고, 규칙 검사와 이벤트 초안 만들기는
// 커밋의 build 안에서 한다. 같은 requestId의 재호출은 build를 거치지 않고 처음 결과를 되풀이한다(TX-05).

const GOALS = WorkGoals.id;
const REPORTS = WorkReports.id;
type Capability = CapabilityId;

/** 거부 레코드의 code. detail에 GoalFailure JSON이 든다 */
const REJECTED_CODE = "goal_rejected";

export interface WorkGoalsDeps extends WorkTasksDeps {
  /** 보고의 durationMs와 완료 게이트 안내 메시지의 시각 */
  readonly clock: Clock;
  /** `l1.agents.judge.maxRuns`의 유효 값. 목표 설정 때 `Goal.maxRuns`에 적고, 상한 도달 판정에 쓴다 */
  readonly maxRuns: (threadId: ThreadId) => number;
}

type PlannedEvent =
  | { readonly kind: "work.goal_set"; readonly payload: WorkGoalSetPayload }
  | { readonly kind: "work.goal_judged"; readonly payload: WorkGoalJudgedPayload }
  | { readonly kind: "work.goal_settled"; readonly payload: WorkGoalSettledPayload }
  | { readonly kind: "work.report_built"; readonly payload: WorkReportBuiltPayload };

type Committed = Extract<CommitResult, { status: "committed" }>;

type Settled =
  | { readonly kind: "committed"; readonly result: Committed }
  | { readonly kind: "rejected"; readonly failure: GoalFailure };

type Terminal = Exclude<GoalStatus, "active">;

/** 완료 게이트가 판정 결과로 목표에 하는 일 */
export type SettleAction =
  | {
      readonly kind: "judged";
      /** L1.agents가 센 판정 순번(`JudgeRecord.run`) */
      readonly n: number;
      readonly verdict: {
        readonly met: boolean;
        readonly reason: string;
        readonly missing: readonly string[];
      };
      readonly usage: Usage | null;
    }
  /** 판정 없이 상한 처리(L1.agents가 capped를 돌려줌) */
  | { readonly kind: "capped" }
  | { readonly kind: "failed"; readonly message: string };

/** 완료 게이트가 판정 하나를 기록한 결과 */
type SettleRecord =
  | { readonly kind: "recorded"; readonly goal: Goal }
  /** 목표가 이미 끝났거나 지워져 기록하지 않았다 */
  | { readonly kind: "skipped" };

export interface GoalsRuntime {
  readonly goalsApi: CapabilityApi<typeof WorkGoals>;
  readonly reportsApi: CapabilityApi<typeof WorkReports>;
  /** 활성 목표(없으면 undefined). 완료 게이트가 읽는다 */
  activeGoal(threadId: ThreadId): Result<GoalRow | undefined, ReadFailure>;
  judgments(threadId: ThreadId, goalId: GoalId): Result<JudgmentRow[], ReadFailure>;
  /** 완료 게이트가 모델 판정 결과 하나를 기록한다. 쓰기 큐 안에서 목표가 아직 활성인지 다시 본다. 실패는 CapabilityError로 거부한다 */
  settleTurn(
    threadId: ThreadId,
    turnId: TurnId,
    goalId: GoalId,
    action: SettleAction,
  ): Promise<SettleRecord>;
  readonly maxRuns: (threadId: ThreadId) => number;
}

function idPart(id: string): number {
  return Number(id.slice(1));
}

/** 순번에서 목표 ID를 만든다. 순번이 6자리를 넘으면 ID 형식을 벗어나 거부한다 */
function goalIdOf(n: number): Result<GoalId, GoalFailure> {
  const parsed = parse(GoalIdSchema, `g${String(n)}`);
  return parsed.ok
    ? ok(parsed.value)
    : err({ kind: "invalid_input", message: "The thread reached its goal limit." });
}

function activeOf(goals: readonly GoalRow[]): GoalRow | undefined {
  return goals.find((row) => row.goal.status === "active");
}

/** 판정 이유는 비어 있을 수 없다(스키마 최소 길이 1) */
function reasonOf(text: string): string {
  const trimmed = text.trim().slice(0, 2000);
  return trimmed === "" ? "(no rationale)" : trimmed;
}

function terminalOf(met: boolean, n: number, maxRuns: number): Terminal | undefined {
  if (met) return "met";
  return n >= maxRuns ? "limit_reached" : undefined;
}

/** 완료 게이트의 판정 기록 커밋 키. 같은 목표의 같은 순번은 한 번만 기록된다 */
function settleKeyOf(goalId: GoalId, action: SettleAction): string {
  switch (action.kind) {
    case "judged":
      return `work:goal:${goalId}:judge:${String(action.n)}`;
    case "capped":
      return `work:goal:${goalId}:settle:capped`;
    case "failed":
      return `work:goal:${goalId}:settle:failed`;
    default:
      return assertNever(action, "SettleAction");
  }
}

const read = orThrowIn;

function lastAssistantText(
  events: readonly DurableEventEnvelope[],
  turnId: TurnId,
): string | undefined {
  for (const event of events.toReversed()) {
    if (event.turnId !== turnId) continue;
    const payload = parse(ItemRecordedPayloadSchema, event.payload);
    if (!payload.ok || payload.value.item.kind !== "assistant") continue;
    const text = payload.value.item.message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    if (text !== "") return text;
  }
  return undefined;
}

function payloadOf<T>(
  capability: Capability,
  method: string,
  events: readonly DurableEventEnvelope[],
  kind: string,
  parser: (payload: unknown) => Result<T, unknown>,
): T {
  const event = events.find((candidate) => candidate.kind === kind);
  const parsed = event === undefined ? undefined : parser(event.payload);
  if (parsed === undefined || !parsed.ok) {
    throw internalError(capability, method, `The commit holds no readable ${kind} event.`);
  }
  return parsed.value;
}

export function createGoals(deps: WorkGoalsDeps): GoalsRuntime {
  const queue = createThreadQueue();

  function draftsOf(
    scope: Pick<CallScope, "threadId" | "turnId">,
    events: readonly PlannedEvent[],
  ): StampedDraft[] {
    return events.map((event) =>
      deps.producer.draft({
        id: deps.ids.next("evt"),
        kind: event.kind,
        threadId: scope.threadId,
        turnId: scope.turnId,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: event.payload,
      }),
    );
  }

  /** 커밋 하나. build가 거부하면 거부 레코드(detail에 GoalFailure JSON)가 남아 같은 requestId 재호출이 같은 거부를 되풀이한다 */
  function commitEvents(
    capability: Capability,
    method: string,
    scope: Pick<CallScope, "threadId" | "turnId">,
    key: string,
    fingerprint: unknown,
    plan: () => Result<readonly PlannedEvent[], GoalFailure>,
  ): Settled {
    const source = toJsonValue({ method, input: fingerprint });
    if (source === undefined) {
      throw internalError(capability, method, "The input is not plain JSON values.");
    }
    // 규칙 검사는 쓰기 큐 안에서 커밋 앞에 한다. 투영 읽기와 보고 재료 읽기가 build 밖에서 일어나 읽기 실패를 CapabilityError로 거부할 수 있다
    const planned = plan();
    const committed = deps.session.commit({
      threadId: scope.threadId,
      requestId: key,
      fingerprintSource: source,
      build: (): CommitPlan => {
        if (!planned.ok) {
          return { kind: "reject", code: REJECTED_CODE, detail: encodeGoalFailure(planned.error) };
        }
        return { kind: "append", drafts: draftsOf(scope, planned.value), checkpoint: null };
      },
    });
    if (!committed.ok) throw storeRejection(capability, method, committed.error);
    const result = committed.value;
    switch (result.status) {
      case "committed":
        return { kind: "committed", result };
      case "rejected": {
        const stored = decodeGoalFailure(result.detail);
        if (stored === undefined) {
          throw internalError(capability, method, "A stored rejection is damaged.");
        }
        return { kind: "rejected", failure: stored };
      }
      case "key_reused":
        deps.logger.error("work.goals.key_reused", { method, key });
        throw internalError(
          capability,
          method,
          "The requestId was already used with a different input.",
        );
      default:
        return assertNever(result, "commit result");
    }
  }

  /** 커밋이 낸 work.* 이벤트를 다시 읽는다. 재전송된 커밋(같은 requestId)의 처음 결과도 이 이벤트에서 만든다 */
  function eventsOf(
    capability: Capability,
    method: string,
    threadId: ThreadId,
    committed: Committed,
  ): readonly DurableEventEnvelope[] {
    const count = committed.lastSeq - committed.firstSeq + 1;
    const found = deps.session.feed.read(
      committed.firstSeq - 1,
      committed.lastSeq,
      { threadIds: [threadId], kindPrefixes: ["work."] },
      count,
      count,
    );
    return read(capability, method, found).events;
  }

  function currentGoal(
    capability: Capability,
    method: string,
    threadId: ThreadId,
    goalId: GoalId,
  ): Goal {
    const goals = read(capability, method, readGoals(deps.reader, threadId));
    const found = goals.find((row) => row.goal.goalId === goalId);
    if (found === undefined) {
      throw internalError(capability, method, `Goal ${goalId} is missing after the write.`);
    }
    return found.goal;
  }

  // ── 보고 재료 ─────────────────────────────────────────────────────────────

  /** `afterSeq` 뒤에 끝난 turn들(`turn.completed`). 대상 범위의 사용량과 시간의 원천이다 */
  function turnsAfter(
    capability: Capability,
    method: string,
    threadId: ThreadId,
    afterSeq: number,
  ): TurnFact[] {
    const head = read(capability, method, deps.session.feed.headSeq());
    const found = read(
      capability,
      method,
      deps.session.feed.read(
        afterSeq,
        head,
        { threadIds: [threadId], kindPrefixes: ["turn.completed"] },
        100_000,
        1_000_000,
      ),
    );
    return found.events.map((event) => {
      const payload = parse(TurnCompletedPayloadSchema, event.payload);
      if (!payload.ok || event.turnId === null) {
        throw internalError(capability, method, "A stored turn.completed event is damaged.");
      }
      return {
        seq: event.seq,
        turnId: event.turnId,
        status: payload.value.status,
        usage: payload.value.usage,
        recordedAt: event.recordedAt,
      };
    });
  }

  function nextReportId(capability: Capability, method: string, threadId: ThreadId): ReportId {
    const reports = read(capability, method, readReports(deps.reader, threadId));
    const next = reports.reduce((max, report) => Math.max(max, idPart(report.reportId)), 0) + 1;
    const parsed = parse(ReportIdSchema, `r${String(next)}`);
    if (!parsed.ok) throw internalError(capability, method, "The thread reached its report limit.");
    return parsed.value;
  }

  interface CallerExtras {
    readonly summary?: string | undefined;
    readonly artifacts?: ReportFacts["artifacts"] | undefined;
  }

  /** 목표 보고의 재료. `pending`은 같은 커밋에 들어가는 아직 투영에 없는 판정이다 */
  function goalFacts(
    capability: Capability,
    method: string,
    threadId: ThreadId,
    row: GoalRow,
    outcome: ReportOutcome,
    reason: string | undefined,
    pending: readonly JudgmentRow[],
    extras: CallerExtras,
  ): ReportFacts {
    const upto = row.settledSeq ?? Number.MAX_SAFE_INTEGER;
    const turns = turnsAfter(capability, method, threadId, row.setSeq).filter(
      (turn) => turn.seq <= upto,
    );
    const stored = read(capability, method, readJudgments(deps.reader, threadId, row.goal.goalId));
    return {
      reportId: nextReportId(capability, method, threadId),
      subject: { kind: "goal", goalId: row.goal.goalId },
      outcome,
      summary: extras.summary,
      reason: reason ?? row.goal.lastVerdict?.reason,
      finalText: undefined,
      turns,
      judgments: [...stored, ...pending],
      startedAt: row.setAt,
      endedAt: deps.clock.now(),
      tasks: read(capability, method, readTasks(deps.reader, threadId)),
      missing: row.goal.lastVerdict?.missing ?? [],
      artifacts: extras.artifacts ?? [],
      plans: read(capability, method, readPlans(deps.reader, threadId)),
      planAfterSeq: row.setSeq,
    };
  }

  /** 목표를 끝내는 이벤트 둘(종결과 보고). 보고는 종결 커밋에 함께 든다(spec §4.4 2항) */
  function settleEvents(
    method: string,
    threadId: ThreadId,
    row: GoalRow,
    status: Terminal,
    reason: string | undefined,
    pending: readonly JudgmentRow[] = [],
  ): readonly PlannedEvent[] {
    const judgments = row.goal.judgments;
    const settled: PlannedEvent = {
      kind: "work.goal_settled",
      payload: { goalId: row.goal.goalId, status, judgments },
    };
    const closed: GoalRow = { ...row, goal: { ...row.goal, status } };
    const report: WorkReport = composeReport(
      goalFacts(GOALS, method, threadId, closed, status, reason, pending, {}),
    );
    return [settled, { kind: "work.report_built", payload: { report } }];
  }

  /** 모델·위임 판정 하나와 그 결과로 목표가 끝나면 종결·보고 이벤트 */
  function judgedEvents(
    method: string,
    threadId: ThreadId,
    turnId: TurnId,
    row: GoalRow,
    judge: {
      readonly kind: "model" | "delegated";
      readonly n: number;
      readonly verdict: {
        readonly met: boolean;
        readonly reason: string;
        readonly missing: readonly string[];
      };
      readonly usage: Usage | null;
    },
  ): readonly PlannedEvent[] {
    const verdict = {
      met: judge.verdict.met,
      reason: reasonOf(judge.verdict.reason),
      missing: judge.verdict.missing.slice(0, 20).map((item) => item.slice(0, 500)),
    };
    const payload: WorkGoalJudgedPayload = {
      goalId: row.goal.goalId,
      n: judge.n,
      turnId,
      verdict,
      judgeKind: judge.kind,
      failure: null,
      usage: judge.usage === null ? null : reportUsageOf(judge.usage),
    };
    const { usage: _usage, ...judgment } = payload;
    const pending: JudgmentRow = { judgment, usage: payload.usage, seq: 0 };
    const withVerdict: GoalRow = {
      ...row,
      goal: { ...row.goal, judgments: Math.max(row.goal.judgments, judge.n), lastVerdict: verdict },
    };
    const terminal = terminalOf(verdict.met, judge.n, deps.maxRuns(threadId));
    const judged: PlannedEvent = { kind: "work.goal_judged", payload };
    return terminal === undefined
      ? [judged]
      : [
          judged,
          ...settleEvents(method, threadId, withVerdict, terminal, verdict.reason, [pending]),
        ];
  }

  // ── work.goals ───────────────────────────────────────────────────────────

  /** 같은 목표의 같은 턴에 판정이 이미 있으면 그 판정(위임 판정자의 재호출) */
  function judgeKnown(
    threadId: ThreadId,
    input: GoalJudgeInputValue,
  ): GoalJudgeOutputValue | undefined {
    const goals = read(GOALS, "judge", readGoals(deps.reader, threadId));
    const row = goals.find((candidate) => candidate.goal.goalId === input.goalId);
    if (row === undefined) return undefined;
    const existing = read(GOALS, "judge", readJudgments(deps.reader, threadId, input.goalId)).find(
      (entry) => entry.judgment.turnId === input.turnId,
    );
    return existing === undefined ? undefined : { goal: row.goal, judgment: existing.judgment };
  }

  const goalsApi: CapabilityApi<typeof WorkGoals> = {
    async set(input: GoalSetInputValue, options) {
      const scope = scopeOf(GOALS, "set", options);
      const requestId = requestIdOf(GOALS, "set", options);
      const settled = await queue.run(scope.threadId, () =>
        commitEvents(GOALS, "set", scope, commitKeyOf("goals", requestId), input, () => {
          const goals = read(GOALS, "set", readGoals(deps.reader, scope.threadId));
          const active = activeOf(goals);
          if (active !== undefined && input.replace !== true) {
            return err({ kind: "goal_active", goalId: active.goal.goalId });
          }
          const events: PlannedEvent[] = [];
          if (active !== undefined) {
            events.push(
              ...settleEvents("set", scope.threadId, active, "cleared", "Replaced by a new goal."),
            );
          }
          const goalId = goalIdOf(
            goals.reduce((max, row) => Math.max(max, idPart(row.goal.goalId)), 0) + 1,
          );
          if (!goalId.ok) return goalId;
          const goal: Goal = {
            goalId: goalId.value,
            condition: input.condition,
            judge: input.judge ?? { kind: "model" },
            maxRuns: deps.maxRuns(scope.threadId),
            continuation: input.continuation ?? "self",
            judgments: 0,
            status: "active",
            lastVerdict: null,
          };
          events.push({ kind: "work.goal_set", payload: { goal } });
          return ok(events);
        }),
      );
      if (settled.kind === "rejected") throw goalRejection(GOALS, "set", settled.failure);
      const events = eventsOf(GOALS, "set", scope.threadId, settled.result);
      return {
        goal: payloadOf(GOALS, "set", events, "work.goal_set", (p) => parse(WorkGoalSetSchema, p))
          .goal,
      };
    },

    async status(input: GoalRefInput, options) {
      const scope = scopeOf(GOALS, "status", options);
      return await queue.run(scope.threadId, (): GoalStatusOutputValue => {
        const goals = read(GOALS, "status", readGoals(deps.reader, scope.threadId));
        const row =
          input.goalId === undefined
            ? activeOf(goals)
            : goals.find((candidate) => candidate.goal.goalId === input.goalId);
        if (input.goalId !== undefined && row === undefined) {
          throw goalRejection(GOALS, "status", { kind: "not_found", id: input.goalId });
        }
        if (row === undefined) return { goal: null, recent: [] };
        const judgments = read(
          GOALS,
          "status",
          readJudgments(deps.reader, scope.threadId, row.goal.goalId),
        );
        return { goal: row.goal, recent: judgments.slice(-10).map((entry) => entry.judgment) };
      });
    },

    async clear(input: GoalRefInput, options) {
      const scope = scopeOf(GOALS, "clear", options);
      const requestId = requestIdOf(GOALS, "clear", options);
      const settled = await queue.run(scope.threadId, () =>
        commitEvents(GOALS, "clear", scope, commitKeyOf("goals", requestId), input, () => {
          const goals = read(GOALS, "clear", readGoals(deps.reader, scope.threadId));
          const row =
            input.goalId === undefined
              ? activeOf(goals)
              : goals.find((candidate) => candidate.goal.goalId === input.goalId);
          if (row === undefined)
            return err({ kind: "not_found", id: input.goalId ?? "active goal" });
          if (row.goal.status !== "active") return err({ kind: "goal_closed" });
          return ok(settleEvents("clear", scope.threadId, row, "cleared", "Cleared by the user."));
        }),
      );
      if (settled.kind === "rejected") throw goalRejection(GOALS, "clear", settled.failure);
      const events = eventsOf(GOALS, "clear", scope.threadId, settled.result);
      const closed = payloadOf(GOALS, "clear", events, "work.goal_settled", (p) =>
        parse(WorkGoalSettledSchema, p),
      );
      return { goal: currentGoal(GOALS, "clear", scope.threadId, closed.goalId) };
    },

    async judge(input: GoalJudgeInputValue, options): Promise<GoalJudgeOutputValue> {
      const scope = scopeOf(GOALS, "judge", options);
      const requestId = requestIdOf(GOALS, "judge", options);
      const caller = options?.context?.caller;
      const outcome = await queue.run(
        scope.threadId,
        (): Settled | { readonly kind: "known"; readonly output: GoalJudgeOutputValue } => {
          const known = judgeKnown(scope.threadId, input);
          if (known !== undefined) return { kind: "known", output: known };
          return commitEvents(GOALS, "judge", scope, commitKeyOf("goals", requestId), input, () => {
            const goals = read(GOALS, "judge", readGoals(deps.reader, scope.threadId));
            const row = goals.find((candidate) => candidate.goal.goalId === input.goalId);
            if (row === undefined) return err({ kind: "not_found", id: input.goalId });
            if (row.goal.status !== "active") return err({ kind: "goal_closed" });
            if (row.goal.judge.kind !== "delegated") return err({ kind: "goal_not_delegated" });
            const owner = row.goal.judge.owner;
            const allowed =
              caller?.kind === "host" ||
              (caller?.kind === "extension" && caller.extension === owner);
            if (!allowed)
              return err({ kind: "denied", message: `Only ${owner} may judge this goal.` });
            const waiting = turnsAfter(GOALS, "judge", scope.threadId, row.setSeq);
            if (
              !waiting.some((turn) => turn.turnId === input.turnId && turn.status !== "interrupted")
            ) {
              return err({ kind: "goal_turn_stale" });
            }
            return ok(
              judgedEvents("judge", scope.threadId, input.turnId, row, {
                kind: "delegated",
                n: row.goal.judgments + 1,
                verdict: input.verdict,
                usage: null,
              }),
            );
          });
        },
      );
      if (outcome.kind === "known") return outcome.output;
      if (outcome.kind === "rejected") throw goalRejection(GOALS, "judge", outcome.failure);
      const events = eventsOf(GOALS, "judge", scope.threadId, outcome.result);
      const { usage: _usage, ...judgment } = payloadOf(
        GOALS,
        "judge",
        events,
        "work.goal_judged",
        (p) => parse(WorkGoalJudgedSchema, p),
      );
      return {
        goal: currentGoal(GOALS, "judge", scope.threadId, judgment.goalId),
        judgment: judgment satisfies GoalJudgment,
      };
    },
  };

  // ── work.reports ─────────────────────────────────────────────────────────

  /** turn 보고의 재료: 그 turn의 시작·끝 이벤트와 최종 텍스트 */
  function turnFacts(
    threadId: ThreadId,
    turnId: TurnId,
    extras: CallerExtras,
  ): Result<ReportFacts, GoalFailure> {
    const done = turnsAfter(REPORTS, "build", threadId, 0).find((turn) => turn.turnId === turnId);
    if (done === undefined) return err({ kind: "not_found", id: turnId });
    const starts = read(
      REPORTS,
      "build",
      deps.session.feed.read(
        0,
        done.seq,
        { threadIds: [threadId], kindPrefixes: ["turn.started"] },
        100_000,
        1_000_000,
      ),
    );
    const started = starts.events.findLast((event) => event.turnId === turnId);
    const startSeq = started?.seq ?? done.seq - 1;
    const items = read(
      REPORTS,
      "build",
      deps.session.feed.read(
        startSeq - 1,
        done.seq,
        { threadIds: [threadId], kindPrefixes: ["item.recorded"] },
        10_000,
        100_000,
      ),
    );
    return ok({
      reportId: nextReportId(REPORTS, "build", threadId),
      subject: { kind: "turn", turnId },
      outcome: done.status === "completed" ? "turn_completed" : "turn_failed",
      summary: extras.summary,
      reason: undefined,
      finalText: lastAssistantText(items.events, turnId),
      turns: [done],
      judgments: [],
      startedAt: started?.recordedAt ?? null,
      endedAt: done.recordedAt,
      tasks: read(REPORTS, "build", readTasks(deps.reader, threadId)),
      missing: [],
      artifacts: extras.artifacts ?? [],
      plans: read(REPORTS, "build", readPlans(deps.reader, threadId)),
      planAfterSeq: startSeq - 1,
    });
  }

  function goalReportFacts(
    threadId: ThreadId,
    goalId: GoalId,
    extras: CallerExtras,
  ): Result<ReportFacts, GoalFailure> {
    const goals = read(REPORTS, "build", readGoals(deps.reader, threadId));
    const row = goals.find((candidate) => candidate.goal.goalId === goalId);
    if (row === undefined) return err({ kind: "not_found", id: goalId });
    if (row.goal.status === "active") {
      return err({ kind: "invalid_input", message: "Only a closed goal has a report." });
    }
    return ok(goalFacts(REPORTS, "build", threadId, row, row.goal.status, undefined, [], extras));
  }

  const reportsApi: CapabilityApi<typeof WorkReports> = {
    async build(input: ReportBuildInputValue, options) {
      const scope = scopeOf(REPORTS, "build", options);
      const requestId = requestIdOf(REPORTS, "build", options);
      const settled = await queue.run(scope.threadId, () =>
        commitEvents(REPORTS, "build", scope, commitKeyOf("reports", requestId), input, () => {
          const extras: CallerExtras = { summary: input.summary, artifacts: input.artifacts };
          const { subject } = input;
          const facts =
            subject.kind === "goal"
              ? goalReportFacts(scope.threadId, subject.goalId, extras)
              : turnFacts(scope.threadId, subject.turnId, extras);
          if (!facts.ok) return facts;
          return ok([
            { kind: "work.report_built", payload: { report: composeReport(facts.value) } },
          ]);
        }),
      );
      if (settled.kind === "rejected") throw goalRejection(REPORTS, "build", settled.failure);
      const events = eventsOf(REPORTS, "build", scope.threadId, settled.result);
      return payloadOf(REPORTS, "build", events, "work.report_built", (p) =>
        parse(WorkReportBuiltSchema, p),
      );
    },
  };

  // ── 완료 게이트가 부른다 ─────────────────────────────────────────────────

  function planSettle(
    threadId: ThreadId,
    turnId: TurnId,
    row: GoalRow,
    action: SettleAction,
  ): readonly PlannedEvent[] {
    switch (action.kind) {
      case "judged":
        return judgedEvents("settle", threadId, turnId, row, { ...action, kind: "model" });
      case "capped":
        return settleEvents(
          "settle",
          threadId,
          row,
          "limit_reached",
          "The goal judge reached its run limit.",
        );
      case "failed":
        return settleEvents("settle", threadId, row, "judge_failed", action.message);
      default:
        return assertNever(action, "SettleAction");
    }
  }

  function settleTurn(
    threadId: ThreadId,
    turnId: TurnId,
    goalId: GoalId,
    action: SettleAction,
  ): Promise<SettleRecord> {
    return queue.run(threadId, (): SettleRecord => {
      const goals = read(GOALS, "settle", readGoals(deps.reader, threadId));
      const row = goals.find((candidate) => candidate.goal.goalId === goalId);
      if (row === undefined || row.goal.status !== "active") return { kind: "skipped" };
      const settled = commitEvents(
        GOALS,
        "settle",
        { threadId, turnId },
        settleKeyOf(goalId, action),
        { goalId, turnId, action: action.kind },
        () => ok(planSettle(threadId, turnId, row, action)),
      );
      if (settled.kind === "rejected") return { kind: "skipped" };
      return { kind: "recorded", goal: currentGoal(GOALS, "settle", threadId, goalId) };
    });
  }

  return {
    goalsApi,
    reportsApi,
    activeGoal: (threadId) => {
      const goals = readGoals(deps.reader, threadId);
      return goals.ok ? ok(activeOf(goals.value)) : goals;
    },
    judgments: (threadId, goalId) => readJudgments(deps.reader, threadId, goalId),
    settleTurn,
    maxRuns: deps.maxRuns,
  };
}
