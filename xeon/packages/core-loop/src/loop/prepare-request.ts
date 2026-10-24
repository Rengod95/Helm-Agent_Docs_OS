import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type {
  AgentMessage,
  ModelThinkingLevel,
  ThinkingBudgets,
} from "@xeon/contracts/conversation";
import type { ResolvedModel } from "@xeon/contracts/services";
import { activatedTools } from "./activation.ts";
import { currentLeaf, currentStep, failureText, resolveModel, type TurnRun } from "./turn-run.ts";
import type { LoopFailure } from "./types.ts";

// L1.loop.spec §3.2 단계 2 `prepareRequest`. 모델 바인딩을 정하고, 도구를 광고하고, 커밋된 이벤트로 컨텍스트를 다시 만든다.
// 루프는 메시지 배열을 들고 있지 않는다. 조립이 낸 값만 이 요청에 쓴다(adr.0009 §3.3 "문맥").

/** 추론 수준에 맞는 토큰 예산 하나를 pi-ai `thinkingBudgets` 모양으로 옮긴다. 값은 `xeon.models`가 정한 그대로다(바꾸지 않는다) */
function budgetsOf(level: ModelThinkingLevel, tokens: number | null): ThinkingBudgets | undefined {
  if (tokens === null) return undefined;
  switch (level) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return { [level]: tokens };
    case "off":
    case "xhigh":
    case "max":
      return undefined;
    default:
      return assertNever(level, "budgetsOf");
  }
}

export interface RequestInput {
  /** 조립한 컨텍스트. 변환(`convertToLlm`)은 스트림을 열 때 한다 */
  readonly messages: readonly AgentMessage[];
  readonly model: ResolvedModel["model"];
  readonly thinkingLevel: ModelThinkingLevel;
  /** 레벨별 토큰 예산(L1.loop.spec §4.7). 예산이 없거나 레벨이 예산을 쓰지 않으면 없다 */
  readonly thinkingBudgets?: ThinkingBudgets;
}

export async function prepareRequest(run: TurnRun): Promise<Result<RequestInput, LoopFailure>> {
  const { ctx, running, state, threadId, turnId, scope } = run;
  const step = currentStep(run);
  running.phase = "requesting";
  running.stepIndex = step.stepIndex;

  const resolved = resolveModel(run);
  if (!resolved.ok) return err(resolved.error);

  const activated = await activatedTools(run);
  if (!activated.ok) return err(activated.error);
  let toolset;
  try {
    const child = run.spec.child;
    toolset = await ctx.tools.advertise({
      run:
        child === null
          ? { threadId, caller: "main", depth: 0 }
          : {
              threadId,
              caller: child.tools.caller,
              depth: child.tools.depth,
              ceiling: child.tools.ceiling,
            },
      activated: activated.value,
      ...(child?.tools.allow === undefined ? {} : { allow: child.tools.allow }),
      ...(child?.tools.keepParentList === undefined
        ? {}
        : { keepParentList: child.tools.keepParentList }),
    });
  } catch (error) {
    // 광고 실패(도구 수 초과 등)는 ToolService가 던지는 예상 가능한 실패다. 값으로 바꾼다
    return err({ kind: "tools_unavailable", detail: failureText(error) });
  }

  const leaf = await currentLeaf(run);
  if (!leaf.ok) return leaf;
  const assembled = await ctx.context.assemble(threadId, leaf.value, {
    binding: resolved.value.binding,
    contextWindow: resolved.value.model.contextWindow,
    cachePolicy: resolved.value.cachePolicy,
    tools: toolset.tools,
    basePrompt: state.basePrompt,
    sections: {},
    volatile: {},
    turnId,
    stepId: step.stepId,
    signal: scope.signal,
  });
  if (!assembled.ok) return err({ kind: "context_unavailable", detail: assembled.error.kind });
  for (const warning of assembled.value.warnings) {
    ctx.logger.debug("loop.context_warning", { threadId, turnId, code: warning.code });
  }
  for (const pending of assembled.value.pendingItems) {
    state.prelude.push({
      itemId: ctx.ids.next("itm"),
      status: "completed",
      kind: "system",
      message: pending.message,
    });
  }
  const thinkingBudgets = budgetsOf(
    resolved.value.binding.thinkingLevel,
    resolved.value.thinkingBudgetTokens,
  );
  return ok({
    messages: assembled.value.messages,
    model: resolved.value.model,
    thinkingLevel: resolved.value.binding.thinkingLevel,
    ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }),
  });
}
