import type { ThreadSummary } from "@fresnel/contracts/wire";

/** 열린 대화가 드래프트를 테스트하는 대화인가(AGE-77 Y-04). 표지의 `target`은 드래프트에서는 비어 있어 어느 화면인지는 항목의 `draft`가 알린다 */
export function isDraftTrial(thread: Pick<ThreadSummary, "testRun"> | undefined): boolean {
  const mark = thread?.testRun;
  return mark !== undefined && (mark.kind === "draft" || mark.draft === true);
}
