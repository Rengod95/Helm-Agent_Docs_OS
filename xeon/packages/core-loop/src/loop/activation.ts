import { err, ok, parse, type Result } from "@xeon/contracts";
import type { ToolName } from "@xeon/contracts/capabilities";
import { EffectIntentSchema, EffectResultSchema } from "@xeon/contracts/records";
import { TOOL_SEARCH_NAME, type ToolCallOutcome } from "@xeon/contracts/services";
import type { TurnRun } from "./turn-run.ts";
import type { LoopFailure } from "./types.ts";

// L1.tools.spec §4.1 규칙 5. `advertise`에 넘기는 `activated`는 이 대화의 `tool_search` 결과가 활성화한 도구의 합집합이다.
// turn마다 활성 가지를 한 번 읽어 만들고(재개 뒤에도 같은 집합), 같은 turn 안의 `tool_search` 결과는 그때그때 더한다.

function namesOf(structured: unknown): string[] {
  if (typeof structured !== "object" || structured === null || !("activated" in structured)) {
    return [];
  }
  const names: unknown = structured.activated;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string")
    : [];
}

/** 이 turn이 쓸 활성화 집합. 처음 부르면 활성 가지의 `tool_search` 결과를 읽는다 */
export async function activatedTools(
  run: TurnRun,
): Promise<Result<ReadonlySet<ToolName>, LoopFailure>> {
  if (run.state.activated !== null) return ok(run.state.activated);
  const searchEffects = new Set<string>();
  const activated = new Set<ToolName>();
  for await (const read of run.ctx.session.readBranch(run.threadId)) {
    if (!read.ok) {
      return err({ kind: "read_failed", detail: `activated tools: ${read.error.kind}` });
    }
    const event = read.value;
    if (event.kind === "effect.intent") {
      const intent = parse(EffectIntentSchema, event.payload);
      if (intent.ok && intent.value.toolName === TOOL_SEARCH_NAME)
        searchEffects.add(intent.value.effectId);
    } else if (event.kind === "effect.result") {
      const result = parse(EffectResultSchema, event.payload);
      if (!result.ok || !searchEffects.has(result.value.effectId)) continue;
      for (const name of namesOf(result.value.output?.structuredContent)) activated.add(name);
    }
  }
  run.state.activated = activated;
  return ok(activated);
}

/** 방금 끝난 도구 호출들 중 `tool_search` 결과의 활성화를 집합에 더한다. 집합을 아직 읽지 않았으면 다음에 가지에서 읽는다 */
export function noteActivations(run: TurnRun, outcomes: readonly ToolCallOutcome[]): void {
  const known = run.state.activated;
  if (known === null) return;
  for (const outcome of outcomes) {
    if (outcome.toolCall.name !== TOOL_SEARCH_NAME || outcome.isError) continue;
    for (const name of namesOf(outcome.result.structuredContent)) known.add(name);
  }
}
