import type { ThreadSummary } from "@fresnel/contracts/wire";

/** 열린 대화가 드래프트를 시험하는 대화이면 그 드래프트의 확장 이름이다. 아니면 undefined(AGE-77 Y-04) */
export function trialDraftOf(
  thread: Pick<ThreadSummary, "testRun"> | undefined,
): string | undefined {
  const mark = thread?.testRun;
  if (mark === undefined) return undefined;
  if (mark.kind !== "draft" && mark.draft !== true) return undefined;
  return mark.target ?? undefined;
}
