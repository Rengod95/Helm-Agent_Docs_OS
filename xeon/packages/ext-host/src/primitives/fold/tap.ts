import type { HandlerFailure, TapOutcome } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import { eachInOrder } from "../sequence.ts";
import type { FoldEnv } from "./env.ts";

/** tap: 순차 await. 던져도 기록하고 다음 핸들러로 간다. 반환값은 버린다(X.primitives.spec §4.2) */
export async function foldTap(
  env: FoldEnv,
  entries: readonly HandlerEntry[],
  payload: unknown,
): Promise<TapOutcome> {
  const failures: HandlerFailure[] = [];
  await eachInOrder(entries, async (entry) => {
    const result = await env.runOne(entry, [payload]);
    if (result.kind === "aborted") return "continue";
    if (result.kind === "failed") {
      failures.push(result.failure);
      env.fail(result.failure);
      return "continue";
    }
    if (result.value !== undefined) {
      // 동작에 영향 없다. 진단과 정책 기록만 남긴다
      env.fail(env.failureOf(entry, "value_from_tap", undefined, result.activeMs));
    }
    env.settled(entry, result.activeMs);
    return "continue";
  });
  return { fold: "tap", detached: false, failures };
}
