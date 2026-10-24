import { ok, type Logger, type Result } from "@xeon/contracts";
import type { IdFactory, Message, ThreadId } from "@xeon/contracts/conversation";
import type { ProducerHandle, SessionService } from "@xeon/contracts/records";
import type {
  CompactCheck,
  CompactOutcome,
  ContextError,
  ContextService,
  ModelService,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import { assembleContext } from "./assemble.ts";
import {
  effectiveMessages,
  findHead,
  findPrefixIndex,
  projectBranch,
  readBranchEvents,
  systemMessageOf,
} from "./branch.ts";
import { summarizeBranchDraft } from "./compaction/branch-summary.ts";
import { compactThread, type CompactDeps, type PromptInputs } from "./compaction/compact.ts";
import { shouldCompactTokens } from "./compaction/threshold.ts";
import { convertToLlm } from "./convert.ts";
import { disabledOverflowRecovery, recoverOverflow } from "./overflow.ts";
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettingsSource } from "./settings.ts";

// L1.context.spec §3.1 ContextService 구현. 조립(assemble), 컴팩션(compact, shouldCompact, recoverOverflow),
// 떠난 가지 요약(summarizeBranch)을 한다. 컴팩션 커밋에는 core.context 생산자 핸들과 IdFactory가 필요하다.
// 둘 중 하나라도 없으면 컴팩션은 하지 않고 skipped(disabled) / fail(disabled)를 돌려준다.

export interface ContextServiceDeps {
  readonly session: Pick<SessionService, "readBranch" | "hydrate" | "commit">;
  readonly models: Pick<ModelService, "tokens" | "complete" | "resolve" | "rebind">;
  readonly ext: Pick<ExtHost, "dispatch">;
  /** 호출 시점의 유효 설정. 없으면 기본값이다 */
  readonly settings?: ContextSettingsSource;
  /** 컴팩션 커밋의 생산자(`session.producer("core.context")`). 없으면 컴팩션을 하지 않는다 */
  readonly producer?: ProducerHandle;
  /** 컴팩션 이벤트 id 발급. 없으면 컴팩션을 하지 않는다 */
  readonly ids?: IdFactory;
  readonly logger?: Logger;
}

const COMPACTION_DISABLED: CompactOutcome = { status: "skipped", why: "disabled" };
const NO_CHECK: CompactCheck = { should: false, tokens: 0, threshold: 0 };

export function createContextService(deps: ContextServiceDeps): ContextService {
  const settings =
    deps.settings ?? ((): ReturnType<ContextSettingsSource> => DEFAULT_CONTEXT_SETTINGS);
  /** 스레드마다 가장 최근 조립의 프롬프트 입력. 컴팩션이 새 접두를 만들 때 쓴다 */
  const lastInputs = new Map<ThreadId, PromptInputs>();

  const compactDeps: CompactDeps | null =
    deps.producer === undefined || deps.ids === undefined
      ? null
      : {
          session: deps.session,
          producer: deps.producer,
          ids: deps.ids,
          models: deps.models,
          ext: deps.ext,
          settings,
          promptInputs: (threadId) => lastInputs.get(threadId),
          ...(deps.logger === undefined ? {} : { logger: deps.logger }),
        };

  function contextWindowOf(binding: Parameters<ContextService["shouldCompact"]>[2]): number {
    const rebound = deps.models.rebind(binding);
    return rebound.ok ? rebound.value.model.contextWindow : 0;
  }

  return {
    async assemble(threadId, leaf, opts) {
      const result = await assembleContext({ ...deps, settings }, threadId, leaf, opts);
      if (result.ok) {
        lastInputs.set(threadId, {
          basePrompt: opts.basePrompt,
          sections: opts.sections,
          tools: opts.tools,
        });
      }
      return result;
    },
    compact(threadId, request): Promise<Result<CompactOutcome, ContextError>> {
      if (compactDeps === null) return Promise.resolve(ok(COMPACTION_DISABLED));
      return compactThread(compactDeps, threadId, request);
    },
    async shouldCompact(threadId, leaf, binding): Promise<CompactCheck> {
      const rebound = deps.models.rebind(binding);
      if (!rebound.ok) return NO_CHECK;
      const read = await readBranchEvents(deps, threadId, leaf, undefined);
      if (!read.ok) return NO_CHECK;
      const projected = projectBranch(read.value);
      if (!projected.ok) return NO_CHECK;
      const head = findHead(deps, read.value, projected.value);
      const prefixIndex = findPrefixIndex(projected.value, head);
      const messages = effectiveMessages(
        read.value,
        projected.value,
        head,
        prefixIndex,
        systemMessageOf(projected.value[prefixIndex]),
      );
      const current = settings();
      const tokens = deps.models.tokens.estimateContext(messages).tokens;
      const contextWindow = rebound.value.model.contextWindow;
      return {
        should: shouldCompactTokens(tokens, contextWindow, {
          enabled: current.autoCompact,
          reserveTokens: current.reserveTokens,
          keepRecentTokens: current.keepRecentTokens,
        }),
        tokens,
        threshold: contextWindow - current.reserveTokens,
      };
    },
    estimate: (messages: readonly Message[]) => deps.models.tokens.estimateContext(messages),
    convertToLlm,
    recoverOverflow(threadId, stepId, failed, binding) {
      if (compactDeps === null) return Promise.resolve(disabledOverflowRecovery());
      return recoverOverflow(
        { ...compactDeps, contextWindowOf },
        threadId,
        stepId,
        failed,
        binding,
      );
    },
    summarizeBranch(threadId, from, to, opts) {
      return summarizeBranchDraft({ ...deps, settings }, threadId, from, to, opts);
    },
  };
}
