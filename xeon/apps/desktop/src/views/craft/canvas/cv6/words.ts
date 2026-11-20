// cv6 화면 글의 message id 표(문구는 cv3 키를 다시 쓴다). 종류·자리·블록·결정·리뷰·출처·관계 이름을 한 곳에서 찾는다.
import type { MessageId } from "@fresnel/client/i18n";
import type { SharedRisk, SharedStepId } from "../shared-sample.ts";
import type { Anchor, BlockId, BoundaryId, Kind, RelationKind } from "./model.ts";
import type { HealthState, OriginKind, ReviewState } from "../shared-meta.ts";

export const KIND_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cv3.kind.inject",
  hook: "desktop.craft.canvas.cv3.kind.hook",
  drive: "desktop.craft.canvas.cv3.kind.drive",
  tool: "desktop.craft.canvas.cv3.kind.tool",
};

export const BLOCK_WORD: Readonly<Record<BlockId, MessageId>> = {
  context: "desktop.craft.canvas.cv3.block.context",
  model: "desktop.craft.canvas.cv3.block.model",
  tools: "desktop.craft.canvas.cv3.block.tools",
  ask: "desktop.craft.canvas.cv3.block.ask",
  agents: "desktop.craft.canvas.cv3.block.agents",
  record: "desktop.craft.canvas.cv3.block.record",
};

export const BOUNDARY_WORD: Readonly<Record<BoundaryId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cv3.boundary.start",
  "input-received": "desktop.craft.canvas.cv3.boundary.input",
  "before-turn-end": "desktop.craft.canvas.cv3.boundary.end",
};

const ANCHOR_WORD: Readonly<Record<Anchor, MessageId>> = {
  "before:context": "desktop.craft.canvas.cv3.at.beforeContext",
  "after:context": "desktop.craft.canvas.cv3.at.afterContext",
  "before:model": "desktop.craft.canvas.cv3.at.beforeModel",
  "after:model": "desktop.craft.canvas.cv3.at.afterModel",
  "before:tools": "desktop.craft.canvas.cv3.at.beforeTools",
  "after:tools": "desktop.craft.canvas.cv3.at.afterTools",
  "before:ask": "desktop.craft.canvas.cv3.at.beforeAsk",
  "after:ask": "desktop.craft.canvas.cv3.at.afterAsk",
  "before:agents": "desktop.craft.canvas.cv3.at.beforeAgents",
  "after:agents": "desktop.craft.canvas.cv3.at.afterAgents",
  "before:record": "desktop.craft.canvas.cv3.at.beforeRecord",
  "after:record": "desktop.craft.canvas.cv3.at.afterRecord",
  "feed:context": "desktop.craft.canvas.cv3.at.feedContext",
  "feed:tools": "desktop.craft.canvas.cv3.at.feedTools",
  "boundary:conversation-start": "desktop.craft.canvas.cv3.boundary.start",
  "boundary:input-received": "desktop.craft.canvas.cv3.boundary.input",
  "boundary:before-turn-end": "desktop.craft.canvas.cv3.boundary.end",
  drive: "desktop.craft.canvas.cv3.at.drive",
};

export function anchorWord(a: Anchor): MessageId {
  return ANCHOR_WORD[a];
}

export const DECISION_WORD: Readonly<Record<"block" | "replace" | "ask", MessageId>> = {
  block: "desktop.craft.canvas.cv3.decision.block",
  replace: "desktop.craft.canvas.cv3.decision.replace",
  ask: "desktop.craft.canvas.cv3.decision.ask",
};

export const RISK_WORD: Readonly<Record<SharedRisk, MessageId>> = {
  none: "desktop.craft.canvas.cv3.risk.none",
  read: "desktop.craft.canvas.cv3.risk.read",
  write: "desktop.craft.canvas.cv3.risk.write",
  exec: "desktop.craft.canvas.cv3.risk.exec",
};

export const RISK_LEVEL: Readonly<Record<SharedRisk, number>> = {
  none: 0,
  read: 1,
  write: 2,
  exec: 3,
};

export const REVIEW_WORD: Readonly<Record<ReviewState, MessageId>> = {
  approved: "desktop.craft.canvas.cv3.review.approved",
  pending: "desktop.craft.canvas.cv3.review.pending",
  draft: "desktop.craft.canvas.cv3.review.draft",
  none: "desktop.craft.canvas.cv3.review.none",
};

export const ORIGIN_WORD: Readonly<Record<OriginKind, MessageId>> = {
  builtin: "desktop.craft.canvas.cv3.origin.builtin",
  bundled: "desktop.craft.canvas.cv3.origin.bundled",
  user: "desktop.craft.canvas.cv3.origin.user",
  project: "desktop.craft.canvas.cv3.origin.project",
  managed: "desktop.craft.canvas.cv3.origin.managed",
};

export const HEALTH_WORD: Readonly<Record<HealthState, MessageId>> = {
  ok: "desktop.craft.canvas.cv3.health.ok",
  idle: "desktop.craft.canvas.cv3.health.idle",
  error: "desktop.craft.canvas.cv3.health.error",
  stopped: "desktop.craft.canvas.cv3.health.stopped",
  integrity: "desktop.craft.canvas.cv3.health.integrity",
};

export const RELATION_WORD: Readonly<Record<RelationKind, MessageId>> = {
  handoff: "desktop.craft.canvas.cv3.rel.handoff",
  depends: "desktop.craft.canvas.cv3.rel.depends",
  reads: "desktop.craft.canvas.cv3.rel.reads",
  creates: "desktop.craft.canvas.cv3.rel.creates",
  replaces: "desktop.craft.canvas.cv3.rel.replaces",
};

/** 관계 선의 한 줄 설명(범례) */
export const RELATION_HINT: Readonly<Record<RelationKind, MessageId>> = {
  handoff: "desktop.craft.canvas.cv3.relHint.handoff",
  depends: "desktop.craft.canvas.cv3.relHint.depends",
  reads: "desktop.craft.canvas.cv3.relHint.reads",
  creates: "desktop.craft.canvas.cv3.relHint.creates",
  replaces: "desktop.craft.canvas.cv3.relHint.replaces",
};

export const STEP_WORD: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: "desktop.craft.canvas.cv3.step.diverge",
  explore: "desktop.craft.canvas.cv3.step.explore",
  apply: "desktop.craft.canvas.cv3.step.apply",
  check: "desktop.craft.canvas.cv3.step.check",
  judge: "desktop.craft.canvas.cv3.step.judge",
  search: "desktop.craft.canvas.cv3.step.search",
  read: "desktop.craft.canvas.cv3.step.read",
  summarize: "desktop.craft.canvas.cv3.step.summarize",
};

export const LANE_WORD: Readonly<Record<"code" | "docs" | "tests", MessageId>> = {
  code: "desktop.craft.canvas.cv3.lane.code",
  docs: "desktop.craft.canvas.cv3.lane.docs",
  tests: "desktop.craft.canvas.cv3.lane.tests",
};

/** 1200 → "1.2k" (토큰 수) */
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
}
