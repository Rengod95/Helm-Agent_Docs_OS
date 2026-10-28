import type { BeforeAgentStartPatch } from "@xeon/contracts/extensions";
import { lensBlockFor, renderLensBlock } from "./prompts.ts";
import { extractTerms, openTally, type TallyStore } from "./signals.ts";
import type { HelmState } from "./state.ts";

/**
 * `input.agent.before` collect 핸들러. 탐구 단계면 시스템 프롬프트 끝에 Helm 블록 하나를 붙이고,
 * idle이면 새 turn의 집계표를 열어 사용자 입력의 용어 후보를 채운다(커밋 없음)
 * collect라 핸들러는 모두 원본 payload.systemPrompt를 본다. 다른 핸들러의 교체값은 마지막 값이 이긴다
 */
export function injectLens(
  tallies: TallyStore,
): (
  payload: { readonly prompt: string; readonly systemPrompt: string },
  ctx: { readonly threadId: string; readonly state: Readonly<HelmState> },
) => BeforeAgentStartPatch | undefined {
  return (payload, ctx) => {
    const fresh = openTally(ctx.state.watch);
    if (ctx.state.phase === "idle") {
      tallies.set(ctx.threadId, { ...fresh, promptTerms: extractTerms(payload.prompt) });
      return undefined;
    }
    tallies.set(ctx.threadId, fresh);
    const block = lensBlockFor(ctx.state);
    if (block === undefined) return undefined;
    return { systemPrompt: `${payload.systemPrompt}\n\n${renderLensBlock(block)}` };
  };
}
