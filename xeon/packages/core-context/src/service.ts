import { err, ok, type Result } from "@xeon/contracts";
import type { Message } from "@xeon/contracts/conversation";
import type {
  BranchSummaryDraft,
  CompactCheck,
  CompactOutcome,
  ContextError,
  ContextService,
  OverflowRecovery,
} from "@xeon/contracts/services";
import { assembleContext, type AssembleDeps } from "./assemble.ts";
import { convertToLlm } from "./convert.ts";
import { disabledOverflowRecovery } from "./overflow.ts";

// L1.context.spec §3.1 ContextService 구현. M1은 조립, 변환, 추정을 한다.
// 컴팩션(compact, shouldCompact), 오버플로우 복구, 떠난 가지 요약은 M2다.

export type ContextServiceDeps = AssembleDeps;

const COMPACTION_DISABLED: CompactOutcome = { status: "skipped", why: "disabled" };

/** M1에는 컴팩션 설정이 없다. 임계 검사는 모델 호출 없이 계산한다는 규칙(§3.1)에 맞게 항상 거짓이다 */
const NO_COMPACTION: CompactCheck = { should: false, tokens: 0, threshold: 0 };

export function createContextService(deps: ContextServiceDeps): ContextService {
  return {
    assemble: (threadId, leaf, opts) => assembleContext(deps, threadId, leaf, opts),
    compact: (): Promise<Result<CompactOutcome, ContextError>> =>
      Promise.resolve(ok(COMPACTION_DISABLED)),
    shouldCompact: (): Promise<CompactCheck> => Promise.resolve(NO_COMPACTION),
    estimate: (messages: readonly Message[]) => deps.models.tokens.estimateContext(messages),
    convertToLlm,
    recoverOverflow: (): Promise<OverflowRecovery> => Promise.resolve(disabledOverflowRecovery()),
    summarizeBranch: (): Promise<Result<BranchSummaryDraft, ContextError>> =>
      Promise.resolve(
        err({ kind: "summary_failed", message: "branch summaries are not available before M2" }),
      ),
  };
}
