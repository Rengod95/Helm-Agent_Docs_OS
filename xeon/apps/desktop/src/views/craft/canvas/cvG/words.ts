// cvG 화면 글의 message id 표. 종류·자리·블록·결정·리뷰·출처·관계 이름을 한 곳에서 찾는다.
import type { MessageId } from "@fresnel/client/i18n";
import type { SharedRisk, SharedStepId } from "../shared-sample.ts";
import type { Anchor, BlockId, BoundaryId, Kind, RelationKind } from "./model.ts";
import type { HealthState, OriginKind, ReviewState } from "../shared-meta.ts";

export const KIND_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvG.kind.inject",
  hook: "desktop.craft.canvas.cvG.kind.hook",
  drive: "desktop.craft.canvas.cvG.kind.drive",
  tool: "desktop.craft.canvas.cvG.kind.tool",
};

/** 종류가 하는 일 한 줄(범례·상세) */
export const KIND_DOES: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvG.kindDoes.inject",
  hook: "desktop.craft.canvas.cvG.kindDoes.hook",
  drive: "desktop.craft.canvas.cvG.kindDoes.drive",
  tool: "desktop.craft.canvas.cvG.kindDoes.tool",
};

export const BLOCK_WORD: Readonly<Record<BlockId, MessageId>> = {
  context: "desktop.craft.canvas.cvG.block.context",
  model: "desktop.craft.canvas.cvG.block.model",
  tools: "desktop.craft.canvas.cvG.block.tools",
  ask: "desktop.craft.canvas.cvG.block.ask",
  agents: "desktop.craft.canvas.cvG.block.agents",
  record: "desktop.craft.canvas.cvG.block.record",
};

export const BOUNDARY_WORD: Readonly<Record<BoundaryId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cvG.boundary.start",
  "input-received": "desktop.craft.canvas.cvG.boundary.input",
  "before-turn-end": "desktop.craft.canvas.cvG.boundary.end",
};

const ANCHOR_WORD: Readonly<Record<Anchor, MessageId>> = {
  "before:context": "desktop.craft.canvas.cvG.at.beforeContext",
  "after:context": "desktop.craft.canvas.cvG.at.afterContext",
  "before:model": "desktop.craft.canvas.cvG.at.beforeModel",
  "after:model": "desktop.craft.canvas.cvG.at.afterModel",
  "before:tools": "desktop.craft.canvas.cvG.at.beforeTools",
  "after:tools": "desktop.craft.canvas.cvG.at.afterTools",
  "before:ask": "desktop.craft.canvas.cvG.at.beforeAsk",
  "after:ask": "desktop.craft.canvas.cvG.at.afterAsk",
  "before:agents": "desktop.craft.canvas.cvG.at.beforeAgents",
  "after:agents": "desktop.craft.canvas.cvG.at.afterAgents",
  "before:record": "desktop.craft.canvas.cvG.at.beforeRecord",
  "after:record": "desktop.craft.canvas.cvG.at.afterRecord",
  "feed:context": "desktop.craft.canvas.cvG.at.feedContext",
  "feed:tools": "desktop.craft.canvas.cvG.at.feedTools",
  "boundary:conversation-start": "desktop.craft.canvas.cvG.boundary.start",
  "boundary:input-received": "desktop.craft.canvas.cvG.boundary.input",
  "boundary:before-turn-end": "desktop.craft.canvas.cvG.boundary.end",
  drive: "desktop.craft.canvas.cvG.at.drive",
};

export function anchorWord(a: Anchor): MessageId {
  return ANCHOR_WORD[a];
}

export const DECISION_WORD: Readonly<Record<"block" | "replace" | "ask", MessageId>> = {
  block: "desktop.craft.canvas.cvG.decision.block",
  replace: "desktop.craft.canvas.cvG.decision.replace",
  ask: "desktop.craft.canvas.cvG.decision.ask",
};

export const RISK_WORD: Readonly<Record<SharedRisk, MessageId>> = {
  none: "desktop.craft.canvas.cvG.risk.none",
  read: "desktop.craft.canvas.cvG.risk.read",
  write: "desktop.craft.canvas.cvG.risk.write",
  exec: "desktop.craft.canvas.cvG.risk.exec",
};

export const RISK_LEVEL: Readonly<Record<SharedRisk, number>> = {
  none: 0,
  read: 1,
  write: 2,
  exec: 3,
};

export const REVIEW_WORD: Readonly<Record<ReviewState, MessageId>> = {
  approved: "desktop.craft.canvas.cvG.review.approved",
  pending: "desktop.craft.canvas.cvG.review.pending",
  draft: "desktop.craft.canvas.cvG.review.draft",
  none: "desktop.craft.canvas.cvG.review.none",
};

export const ORIGIN_WORD: Readonly<Record<OriginKind, MessageId>> = {
  builtin: "desktop.craft.canvas.cvG.origin.builtin",
  bundled: "desktop.craft.canvas.cvG.origin.bundled",
  user: "desktop.craft.canvas.cvG.origin.user",
  project: "desktop.craft.canvas.cvG.origin.project",
  managed: "desktop.craft.canvas.cvG.origin.managed",
};

export const HEALTH_WORD: Readonly<Record<HealthState, MessageId>> = {
  ok: "desktop.craft.canvas.cvG.health.ok",
  idle: "desktop.craft.canvas.cvG.health.idle",
  error: "desktop.craft.canvas.cvG.health.error",
  stopped: "desktop.craft.canvas.cvG.health.stopped",
  integrity: "desktop.craft.canvas.cvG.health.integrity",
};

export const RELATION_WORD: Readonly<Record<RelationKind, MessageId>> = {
  handoff: "desktop.craft.canvas.cvG.rel.handoff",
  depends: "desktop.craft.canvas.cvG.rel.depends",
  reads: "desktop.craft.canvas.cvG.rel.reads",
  creates: "desktop.craft.canvas.cvG.rel.creates",
  replaces: "desktop.craft.canvas.cvG.rel.replaces",
};

/** 관계 선의 한 줄 설명(범례) */
export const RELATION_HINT: Readonly<Record<RelationKind, MessageId>> = {
  handoff: "desktop.craft.canvas.cvG.relHint.handoff",
  depends: "desktop.craft.canvas.cvG.relHint.depends",
  reads: "desktop.craft.canvas.cvG.relHint.reads",
  creates: "desktop.craft.canvas.cvG.relHint.creates",
  replaces: "desktop.craft.canvas.cvG.relHint.replaces",
};

export const STEP_WORD: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: "desktop.craft.canvas.cvG.step.diverge",
  explore: "desktop.craft.canvas.cvG.step.explore",
  apply: "desktop.craft.canvas.cvG.step.apply",
  check: "desktop.craft.canvas.cvG.step.check",
  judge: "desktop.craft.canvas.cvG.step.judge",
  search: "desktop.craft.canvas.cvG.step.search",
  read: "desktop.craft.canvas.cvG.step.read",
  summarize: "desktop.craft.canvas.cvG.step.summarize",
};

export const LANE_WORD: Readonly<Record<"code" | "docs" | "tests", MessageId>> = {
  code: "desktop.craft.canvas.cvG.lane.code",
  docs: "desktop.craft.canvas.cvG.lane.docs",
  tests: "desktop.craft.canvas.cvG.lane.tests",
};

/** 1200 → "1.2k" (토큰 수) */
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(Math.round(n / 100) / 10).toFixed(1)}k`;
}
