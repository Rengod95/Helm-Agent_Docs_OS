import { ok, parse, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  EffectIntentSchema,
  EffectResultSchema,
  type BlobRef,
  type ReadFailure,
  type SessionService,
} from "@xeon/contracts/records";
import { TOOL_SEARCH_NAME } from "@xeon/contracts/services";
import { isJsonObject } from "../util.ts";

// L1.tools.spec §4.1 규칙 5, §4.8 6번. 두 내장 도구가 대화 기록(이벤트)에서 상태를 다시 읽는다.
// - 활성화한 지연 도구: `tool_search` 효과 결과의 `structuredContent.activated` 합집합
// - 도구 출력 blob: `effect.result.blobRef`

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

/** 이 대화의 도구 결과가 원문을 옮겨 둔 blob 중 해시가 맞는 것. 없으면 undefined */
export async function toolOutputBlob(
  session: BranchReader,
  threadId: ThreadId,
  sha256: string,
): Promise<Result<BlobRef | undefined, ReadFailure>> {
  for await (const read of session.readBranch(threadId)) {
    if (!read.ok) return read;
    if (read.value.kind !== "effect.result") continue;
    const result = parse(EffectResultSchema, read.value.payload);
    if (result.ok && result.value.blobRef?.sha256 === sha256) return ok(result.value.blobRef);
  }
  return ok(undefined);
}
