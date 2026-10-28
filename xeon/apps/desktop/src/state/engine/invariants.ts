// src/state/engine/invariants.ts
import { SETTLED_CAP, type EngineMirror } from "./state.ts";

const unique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

/** O(N). 개발·시험 빌드의 invariantStage와 속성 시험이 부른다 */
export function checkMirror(state: EngineMirror): readonly string[] {
  const problems: string[] = [];
  const t = state.transcript;
  if (t?.status === "ready") {
    if (!unique(t.itemIds)) problems.push("transcript.itemIds has duplicates");
    if (t.itemIds.length !== Object.keys(t.items).length)
      problems.push("transcript.itemIds and items differ");
    for (const id of state.streaming.itemIds) {
      if (t.items[id] !== undefined) problems.push("recorded item still streaming");
    }
  }
  if (!unique(state.streaming.itemIds)) problems.push("streaming.itemIds has duplicates");
  if (state.streaming.itemIds.length !== Object.keys(state.streaming.items).length) {
    problems.push("streaming.itemIds and items differ");
  }
  if (
    state.streaming.settledItems.length > SETTLED_CAP ||
    state.streaming.settledTurns.length > SETTLED_CAP
  ) {
    problems.push("streaming settled markers exceed the cap");
  }
  if (!unique(state.approvals.ids)) problems.push("approvals.ids has duplicates");
  if (state.approvals.ids.length !== Object.keys(state.approvals.byId).length) {
    problems.push("approvals.ids and byId differ");
  }
  if (state.approvals.resolved.length > SETTLED_CAP)
    problems.push("approvals.resolved exceeds the cap");
  return problems;
}
