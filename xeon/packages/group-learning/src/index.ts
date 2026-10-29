import { attempt, err, ok, type Result } from "@xeon/contracts";
import {
  KnowledgeLedgerKey,
  KnowledgeMemoryKey,
  KnowledgeSearchKey,
  KnowledgeSkillsKey,
} from "@xeon/contracts/capabilities";
import { defineGroup, type GroupModule } from "@xeon/group-kit";
import {
  createReviewControls,
  registerSettledWatch,
  registerTriggers,
  writerOf,
  type HandlerEnv,
  type LearningApi,
} from "./handlers.ts";
import { parseLearningCommand, runLearningCommand, LEARNING_USAGE } from "./commands.ts";
import type { LearningDeps } from "./deps.ts";
import { manifest } from "./manifest.ts";
import {
  createKnowledgePort,
  type KnowledgeFailure,
  type KnowledgePort,
} from "./proposals/knowledge.ts";
import { createQueueOps } from "./proposals/ops.ts";
import { proposeTool } from "./review/propose.ts";
import { learningSettings, readLearningSettings } from "./settings.ts";
import { learningStateDecl } from "./state.ts";

export { createLearningBridge, type LearningBridge, type LearningQueueApi } from "./bridge.ts";
export { decisionCommandLine } from "./commands.ts";
export { APPROVAL_SOURCE } from "./proposals/knowledge.ts";
export type { ProposalDecision } from "./proposals/ops.ts";
export {
  parseProposal,
  proposalView,
  type Proposal,
  type ProposalView,
} from "./proposals/proposal.ts";
export type {
  LearningQueueReader,
  ProposalFilter,
  ReviewFilter,
  ReviewRow,
  StoreFailure,
  StoreResult,
} from "./proposals/reader.ts";
export { applyLearningEvent, type ProjectionRows } from "./proposals/rows.ts";
export { decodeEvent, eventKindOf, LEARNING_EVENT_KINDS } from "./proposals/events.ts";
export { createLearningProjector, createSqlReader, learningProjector } from "./proposals/sql.ts";
export type { CommandReport, DecisionResult, LearningError, QueueSweep } from "./results.ts";
export { learningSettings } from "./settings.ts";
export { manifest as learningManifest } from "./manifest.ts";
export type { LearningDeps } from "./deps.ts";

/** 지식 능력 네 개로 지식 저장소 면을 만든다. 능력이 없거나 일시 실패면 오류 값이다(§5 사례 12) */
function knowledgeOf(g: LearningApi): Result<KnowledgePort, KnowledgeFailure> {
  const apis = attempt(() => ({
    skills: g.capability(KnowledgeSkillsKey),
    memory: g.capability(KnowledgeMemoryKey),
    search: g.capability(KnowledgeSearchKey),
    ledger: g.capability(KnowledgeLedgerKey),
  }));
  if (!apis.ok) {
    return err({
      kind: "learning.knowledgeUnavailable",
      detail: "the knowledge capabilities are not available",
    });
  }
  return ok(createKnowledgePort(apis.value, manifest.name));
}

/**
 * 학습 그룹 모듈. 조립 루트가 넘기는 의존(시계, 대기열 읽기 면)으로 만든다.
 * 같은 패키지의 default export 대신 팩토리를 둔다: 읽기 면을 주입해야 하기 때문이다(TY-21)
 */
export function createLearningGroup(deps: LearningDeps): GroupModule {
  return defineGroup({
    manifest,
    state: learningStateDecl,
    settings: learningSettings,
    setup(g) {
      const settings = () => readLearningSettings(() => g.settings());
      const knowledge = () => knowledgeOf(g);
      const writer = writerOf(g);
      const ops = createQueueOps({
        reader: deps.reader,
        writer,
        clock: deps.clock,
        settings,
        knowledge,
      });
      const env: HandlerEnv = { g, deps, settings, writer, countedReviews: new Set<string>() };
      registerTriggers(env);
      registerSettledWatch(env);
      g.registerTool(
        proposeTool({ reader: deps.reader, clock: deps.clock, settings, knowledge, ops }),
      );
      const review = createReviewControls(env);
      g.registerCommand("learning", {
        description: "학습 승인 대기열과 검토(/learning queue | review)",
        async handler(args, ctx) {
          const parsed = parseLearningCommand(args);
          if (!parsed.ok) {
            deps.report?.({ kind: "usage", text: parsed.usage }, ctx.invocationId);
            return;
          }
          // 호출한 쪽의 취소 신호(ctx.signal)를 그대로 쓴다. 명령 처리가 만든 신호는 이 호출을 취소하지 못한다
          const { signal } = ctx;
          const report = await runLearningCommand(parsed.command, {
            ops,
            signal,
            threadId: ctx.threadId,
            settleInFlight: review.settleInFlight,
            startReview: (threadId) => review.start(threadId, signal),
            cancelReview: review.cancel,
          });
          deps.report?.(report, ctx.invocationId);
        },
      });
      const detach = deps.bridge?.attach({ list: (filter) => ops.list(filter) });
      // 그룹을 끄면 진행 중 검토를 즉시 취소한다 [결정: D-M3-04]. onDispose에는 ambient가 없어 기록과 커밋은 하지 못한다.
      // 취소된 자식의 `agent.settled`는 그룹이 꺼진 동안 구독되지 않으므로, 다시 켠 뒤 첫 turn이 오래된 진행 중 표지를 비우거나 `/learning` 명령 진입이 위임 서비스에 물어 닫는다
      g.onDispose(async () => {
        detach?.();
        await g.cancelDelegates("group_disabled");
      });
    },
  });
}

export { LEARNING_USAGE };
