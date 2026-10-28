import type { Result } from "@xeon/contracts";
import {
  isId,
  type ItemId,
  type ThreadId,
  type TurnId,
  type TurnOrigin,
} from "@xeon/contracts/conversation";
import type { AgentSettledPayload, HandlerContext } from "@xeon/contracts/extensions";
import type { GroupApi } from "@xeon/group-kit";
import type { LearningDeps } from "./deps.ts";
import type { LearningWriter } from "./proposals/ops.ts";
import { eventKindOf, payloadOf } from "./proposals/events.ts";
import { reviewFinishedPayload } from "./records.ts";
import type { CommandReport } from "./results.ts";
import {
  buildReviewSpec,
  manualReviewId,
  reviewFinishOutcome,
  reviewStartOutcome,
  type ReviewSettled,
} from "./review/fork.ts";
import { LEARNING_PROPOSE_TOOL } from "./review/policy.ts";
import type { LearningSettings, LearningSettingDefs, SettingsUnavailable } from "./settings.ts";
import type { LearningState } from "./state.ts";
import { advanceCounters, afterDelegateFailure, applyTurn, type TurnTally } from "./triggers.ts";

// L3.learning.spec §4.2~§4.3, §4.10. 재실행되는 코드는 on 핸들러 셋과 `agent.settled` 구독 핸들러뿐이다. 핸들러는 능력 메서드를 부르지 않는다(ADR-0015 §3.2).
// 쓰기는 모두 ambient 안의 `g.recordPrivate`·`g.record`·`g.commit`이다(핸들러는 디스패치 키, 명령 처리기는 호출 id가 멱등 키다).

export type LearningApi = GroupApi<LearningState, LearningSettingDefs>;

export interface HandlerEnv {
  readonly g: LearningApi;
  readonly deps: LearningDeps;
  readonly settings: () => Result<LearningSettings, SettingsUnavailable>;
  readonly writer: LearningWriter;
}

/** 열린 turn의 집계표. 프로세스 메모리에만 둔다(효과가 아니다, §4.2) */
interface OpenTally {
  turnId: TurnId | null;
  origin: TurnOrigin | undefined;
  toolIterations: number;
  skillWritten: boolean;
  readonly seenSteps: Set<string>;
}

const SKILL_WRITE_TOOLS: ReadonlySet<string> = new Set(["skill_manage", LEARNING_PROPOSE_TOOL]);

/** 진행 중 표지가 이 시간을 넘도록 닫히지 않은 검토는 끝난 것으로 본다(그룹이 꺼진 동안 끝난 검토) [제안] */
const STALE_REVIEW_MS = 2 * 60 * 60 * 1000;

function sameState(a: LearningState, b: LearningState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function writerOf(g: LearningApi): LearningWriter {
  return {
    event: (event) => g.recordPrivate(eventKindOf(event), payloadOf(event)),
    record: (draft) => g.record(draft.kind, draft.subject, draft.payload),
  };
}

function usageTokens(usage: { readonly input: number; readonly output: number } | null): {
  readonly inputTokens: number;
  readonly outputTokens: number;
} {
  return usage === null
    ? { inputTokens: 0, outputTokens: 0 }
    : { inputTokens: usage.input, outputTokens: usage.output };
}

/** 검토 종료를 기록한다: `fork.finished`, `review.finished`, 후보 알림 없음(후보는 만들 때 알렸다), 상태 커밋. 구독 핸들러와 명령 진입 정리가 같이 쓴다 */
async function finishReview(
  env: HandlerEnv,
  threadId: ThreadId,
  settled: ReviewSettled,
): Promise<void> {
  const { g, deps, writer } = env;
  const finish = reviewFinishOutcome(g.state(), settled);
  if (finish.kind === "ignore") return;
  const made = await deps.reader.listProposals({ reviewId: settled.requestId });
  const proposalIds = made.ok ? made.value.map((proposal) => proposal.id) : [];
  const tokens = usageTokens(settled.usage);
  await writer.event({
    kind: "fork.finished",
    requestId: settled.requestId,
    parentThreadId: threadId,
    outcome: finish.outcome,
    proposalIds,
    ...tokens,
    at: deps.clock.now(),
  });
  await g.record(
    "grp.learning.review.finished",
    { type: "thread", id: threadId },
    reviewFinishedPayload({
      reviewId: settled.requestId,
      outcome: finish.outcome,
      proposalCount: proposalIds.length,
      ...tokens,
    }),
  );
  // 커밋은 마지막이다. 직전에 다시 읽어 선후 경합을 본다(§4.3)
  const latest = g.state();
  const next = reviewFinishOutcome(latest, settled);
  if (next.kind === "finished" && !sameState(next.next, latest)) await g.commit(next.next);
}

export function registerTriggers(env: HandlerEnv): void {
  const { g, deps, writer } = env;
  const tallies = new Map<string, OpenTally>();

  async function commitIfChanged(next: LearningState): Promise<void> {
    if (!sameState(g.state(), next)) await g.commit(next);
  }

  /** 정착했는데 진행 중 표지가 남은 검토(그룹이 꺼진 동안 끝남)를 투영된 검토 행으로 비운다 [제안]. 행이 닫혔거나 너무 오래되면 끝난 검토다 */
  async function reconcile(state: LearningState, threadId: ThreadId): Promise<LearningState> {
    const pending = state.inFlightReviewId;
    if (pending === null) return state;
    const row = await deps.reader.getReview(threadId, pending);
    if (!row.ok || row.value === undefined) return state;
    const stale = deps.clock.now() - row.value.startedAt > STALE_REVIEW_MS;
    if (row.value.finishedAt !== null || stale) {
      return { ...state, inFlightReviewId: null, settledReviewId: pending };
    }
    return state;
  }

  g.on("boundary.turn.before", (payload, hctx) => {
    tallies.set(hctx.threadId, {
      turnId: payload.turnId,
      origin: payload.origin,
      toolIterations: 0,
      skillWritten: false,
      seenSteps: new Set(),
    });
  });

  // chain 지점이지만 값을 바꾸지 않고 undefined를 돌려준다: 시스템 프롬프트와 컨텍스트에 영향이 없다(캐시 접두 보존)
  g.on("boundary.step.after", (payload, _current, hctx) => {
    const open = tallies.get(hctx.threadId) ?? {
      turnId: null,
      origin: undefined,
      toolIterations: 0,
      skillWritten: false,
      seenSteps: new Set<string>(),
    };
    tallies.set(hctx.threadId, open);
    if (payload.toolResults.length === 0 || open.seenSteps.has(payload.stepId)) return undefined;
    open.seenSteps.add(payload.stepId);
    open.toolIterations += 1;
    if (payload.toolResults.some((result) => SKILL_WRITE_TOOLS.has(result.toolName))) {
      open.skillWritten = true;
    }
    return undefined;
  });

  async function onSettled(
    payload: AgentSettledPayload,
    hctx: HandlerContext<LearningState>,
  ): Promise<void> {
    // 같은 turn으로 다시 발화했으면 이미 반영했다: 이 핸들러의 마지막 효과가 커밋이라 커밋이 남았으면 앞선 효과(위임, 기록)도 남았다(ADR-0015)
    if (g.state().lastTurnId === payload.turnId) return;
    const open = tallies.get(hctx.threadId);
    const matched =
      open !== undefined && (open.turnId === null || open.turnId === payload.turnId)
        ? open
        : undefined;
    const tally: TurnTally = {
      turnId: payload.turnId,
      origin: payload.origin ?? matched?.origin ?? "user",
      status: payload.status ?? (payload.aborted ? "aborted" : "completed"),
      hasFinalAnswer: payload.hasFinalAnswer ?? true,
      toolIterations: matched?.toolIterations ?? 0,
      skillWritten: matched?.skillWritten ?? false,
    };
    const lastItemId = payload.lastItemId ?? null;
    const withItem = (next: LearningState): LearningState =>
      lastItemId === null ? next : { ...next, lastItemId };
    const settings = env.settings();
    // 설정을 읽지 못하면 검토를 시작하지 않는다(fail-closed, §4.1)
    if (!settings.ok) return;
    const before = await reconcile(g.state(), hctx.threadId);
    const decision = applyTurn(
      before,
      tally,
      { userTurns: settings.value.userTurns, toolIterations: settings.value.toolIterations },
      true,
    );
    if (decision.kind === "skip") {
      await commitIfChanged(withItem(decision.next));
      return;
    }
    // 포크 지점을 정할 수 없으면 검토를 시작하지 않고 카운터를 유지한다(§5 사례 17)
    if (lastItemId === null) {
      await commitIfChanged(advanceCounters(before, tally));
      return;
    }
    const spec = buildReviewSpec({
      parent: { threadId: hctx.threadId, upToItemId: lastItemId },
      requestId: decision.requestId,
      reasons: decision.reasons,
      settings: settings.value,
      contextWindow: null,
    });
    // 위임 먼저, 커밋 나중(§4.3). 같은 지점이 다시 발화하면 같은 requestId라 duplicate다
    const started = reviewStartOutcome(
      await g.delegate(spec, { threadId: hctx.threadId, signal: hctx.signal }),
    );
    if (started.kind === "retryLater") {
      await commitIfChanged(withItem(afterDelegateFailure(before, advanceCounters(before, tally))));
      return;
    }
    // `already`(duplicate)에서도 쓴다: 위임과 이 기록 사이에서 프로세스가 끝났으면 기록이 없다. 같은 디스패치 키의 두 번째 쓰기는 X가 한 번으로 합친다 [제안]
    await writer.event({
      kind: "fork.started",
      requestId: decision.requestId,
      epoch: decision.next.epoch,
      childThreadId: started.childThreadId,
      reasons: [...decision.reasons],
      parentThreadId: hctx.threadId,
      at: deps.clock.now(),
    });
    // 커밋 직전에 다시 읽는다: 자식이 이미 정착해 구독 핸들러가 먼저 돌았으면 진행 중 표지를 세우지 않는다(§4.3 4)
    const fresh = g.state();
    const settledFirst = fresh.settledReviewId === decision.requestId;
    await commitIfChanged(
      withItem({
        ...decision.next,
        settledReviewId: fresh.settledReviewId ?? decision.next.settledReviewId,
        inFlightReviewId: settledFirst ? null : decision.next.inFlightReviewId,
      }),
    );
  }

  g.on("boundary.settle.after", async (payload, hctx) => {
    await onSettled(payload, hctx);
    // 반영을 마친 뒤에만 집계표를 버린다. 도중에 실패해 다시 발화하면 집계표가 남아 있다
    tallies.delete(hctx.threadId);
  });
}

/** 코어 이벤트 `agent.settled` 구독(§4.3 완료 통지). 기록과 커밋은 디스패치 키(이벤트 id)로 멱등이다 */
export function registerSettledWatch(env: HandlerEnv): void {
  const { g } = env;
  g.on("lifecycle.agent.settled", async (payload, hctx) => {
    const { owner } = payload;
    if (owner !== undefined && !(owner.kind === "scope" && owner.scopeId === g.id)) return;
    await finishReview(env, hctx.threadId, payload);
  });
}

/** 수동 검토 시작·취소와 명령 진입 정리(`/learning`). 명령 처리기는 재실행되지 않고 ambient가 있어 상태를 읽고 커밋한다 */
export function createReviewControls(env: HandlerEnv): {
  readonly settleInFlight: (threadId: ThreadId) => Promise<void>;
  readonly start: (threadId: ThreadId, signal: AbortSignal) => Promise<CommandReport>;
  readonly cancel: () => Promise<CommandReport>;
} {
  const { g, deps, writer } = env;
  return {
    /** 진행 중 표지가 남은 검토를 위임 서비스에 물어 닫는다(구독이 놓친 경우). 서비스가 모르는 검토도 끝난 것으로 본다 */
    async settleInFlight(threadId) {
      const pending = g.state().inFlightReviewId;
      if (pending === null) return;
      const status = g.delegateStatus(pending, { threadId });
      if (!status.ok) return;
      if (status.status !== undefined && status.status.state !== "settled") return;
      await finishReview(env, threadId, {
        requestId: pending,
        childThreadId: status.status?.childThreadId ?? threadId,
        status: status.status?.state === "settled" ? status.status.status : "aborted",
        usage: null,
      });
    },
    async start(threadId, signal) {
      const settings = env.settings();
      if (!settings.ok) return { kind: "error", error: settings.error };
      const state = g.state();
      if (state.inFlightReviewId !== null) {
        return {
          kind: "review",
          result: {
            ok: false,
            error: { kind: "learning.reviewBusy", requestId: state.inFlightReviewId },
          },
        };
      }
      const lastItem: ItemId | null = state.lastItemId === null ? null : toItemId(state.lastItemId);
      if (lastItem === null) {
        return { kind: "review", result: { ok: false, error: { kind: "learning.noSnapshot" } } };
      }
      const epoch = state.epoch + 1;
      const requestId = manualReviewId(epoch);
      const spec = buildReviewSpec({
        parent: { threadId, upToItemId: lastItem },
        requestId,
        reasons: ["manual"],
        settings: settings.value,
        contextWindow: null,
      });
      // 위임 먼저, 기록과 커밋 나중(§4.3). 같은 호출 id의 재실행은 같은 requestId와 같은 멱등 키를 만든다
      const started = reviewStartOutcome(await g.delegate(spec, { threadId, signal }));
      if (started.kind === "retryLater") {
        return {
          kind: "review",
          result: { ok: false, error: { kind: "learning.delegateFailed", cause: started.error } },
        };
      }
      await writer.event({
        kind: "fork.started",
        requestId,
        epoch,
        childThreadId: started.childThreadId,
        reasons: ["manual"],
        parentThreadId: threadId,
        at: deps.clock.now(),
      });
      const fresh = g.state();
      const settledFirst = fresh.settledReviewId === requestId;
      await g.commit({
        ...fresh,
        epoch,
        lastReviewId: requestId,
        inFlightReviewId: settledFirst ? null : requestId,
      });
      return {
        kind: "review",
        result: { ok: true, requestId, duplicate: started.kind === "already" },
      };
    },
    async cancel() {
      // 취소된 자식도 `agent.settled{ aborted }`를 남기고 구독 핸들러가 검토를 닫는다
      const cancelled = await g.cancelDelegates("learning_review_cancel");
      return { kind: "cancel", cancelled: cancelled.ok ? cancelled.cancelled : false };
    },
  };
}

function toItemId(value: string): ItemId | null {
  return isId("itm", value) ? value : null;
}
