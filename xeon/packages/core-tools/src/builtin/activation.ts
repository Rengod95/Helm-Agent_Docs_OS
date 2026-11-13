import { ok, parse, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  EffectIntentSchema,
  EffectResultSchema,
  type ReadFailure,
  type SessionService,
} from "@fresnel/contracts/records";
import { TOOL_SEARCH_NAME } from "@fresnel/contracts/services";
import { isJsonObject } from "../util.ts";

// L1.tools.spec §4.1 규칙 5. 활성화한 지연 도구는 `tool_search` 효과 결과의 `structuredContent.activated` 합집합으로 대화 기록에서 다시 읽는다.

export type BranchReader = Pick<SessionService, "readBranch">;

/** 이 대화의 `tool_search` 결과가 활성화한 도구 이름. 재개 뒤에도 같은 집합이 나온다 */
export async function activatedTools(
  session: BranchReader,
  threadId: ThreadId,
): Promise<Result<ReadonlySet<string>, ReadFailure>> {
  const searchEffects = new Set<string>();
  const activated = new Set<string>();
  for await (const read of session.readBranch(threadId)) {
    if (!read.ok) return read;
    const event = read.value;
    if (event.kind === "effect.intent") {
      const intent = parse(EffectIntentSchema, event.payload);
      if (intent.ok && intent.value.toolName === TOOL_SEARCH_NAME) {
        searchEffects.add(intent.value.effectId);
      }
    } else if (event.kind === "effect.result") {
      const result = parse(EffectResultSchema, event.payload);
      if (!result.ok || !searchEffects.has(result.value.effectId)) continue;
      const structured = result.value.output?.structuredContent;
      const names = isJsonObject(structured) ? structured["activated"] : undefined;
      if (!Array.isArray(names)) continue;
      for (const name of names) if (typeof name === "string") activated.add(name);
    }
  }
  return ok(activated);
}
