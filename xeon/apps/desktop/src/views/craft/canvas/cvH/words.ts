// cvH 화면 글의 message id 표. 종류·정거장·자리·결정·위험·리뷰·출처의 이름을 한 곳에서 찾는다.
import type { MessageId } from "@fresnel/client/i18n";
import type {
  CardReviewState,
  Fold,
  PluginEnforcement,
  PluginHealthState,
  PluginOriginKind,
} from "@fresnel/contracts/extensions";
import type { SharedRisk, SharedStepId } from "../shared-sample.ts";
import type { Kind, RelationKind, SlotId } from "./model.ts";

export const KIND_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvH.kind.inject",
  hook: "desktop.craft.canvas.cvH.kind.hook",
  drive: "desktop.craft.canvas.cvH.kind.drive",
  tool: "desktop.craft.canvas.cvH.kind.tool",
};

/** 종류마다 지선이 본선에 붙는 방식 한마디 */
export const BRANCH_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvH.branch.inject",
  hook: "desktop.craft.canvas.cvH.branch.hook",
  drive: "desktop.craft.canvas.cvH.branch.drive",
  tool: "desktop.craft.canvas.cvH.branch.tool",
};

export const SLOT_WORD: Readonly<Record<SlotId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cvH.slot.start",
  "input-received": "desktop.craft.canvas.cvH.slot.input",
  context: "desktop.craft.canvas.cvH.slot.context",
  "model.before": "desktop.craft.canvas.cvH.slot.modelBefore",
  model: "desktop.craft.canvas.cvH.slot.model",
  "tools.before": "desktop.craft.canvas.cvH.slot.toolsBefore",
  tools: "desktop.craft.canvas.cvH.slot.tools",
  "tools.after": "desktop.craft.canvas.cvH.slot.toolsAfter",
  ask: "desktop.craft.canvas.cvH.slot.ask",
  agents: "desktop.craft.canvas.cvH.slot.agents",
  record: "desktop.craft.canvas.cvH.slot.record",
  "before-turn-end": "desktop.craft.canvas.cvH.slot.end",
};

export const DECISION_WORD: Readonly<Record<"block" | "replace" | "ask", MessageId>> = {
  block: "desktop.craft.canvas.cvH.decision.block",
  replace: "desktop.craft.canvas.cvH.decision.replace",
  ask: "desktop.craft.canvas.cvH.decision.ask",
};

export const FOLD_WORD: Readonly<Record<Fold, MessageId>> = {
  first: "desktop.craft.canvas.cvH.fold.first",
  chain: "desktop.craft.canvas.cvH.fold.chain",
  tap: "desktop.craft.canvas.cvH.fold.tap",
  collect: "desktop.craft.canvas.cvH.fold.collect",
};

export const RISK_WORD: Readonly<Record<SharedRisk, MessageId>> = {
  none: "desktop.craft.canvas.cvH.risk.none",
  read: "desktop.craft.canvas.cvH.risk.read",
  write: "desktop.craft.canvas.cvH.risk.write",
  exec: "desktop.craft.canvas.cvH.risk.exec",
};

export const REVIEW_WORD: Readonly<Record<CardReviewState, MessageId>> = {
  approved: "desktop.craft.canvas.cvH.review.approved",
  pending: "desktop.craft.canvas.cvH.review.pending",
  draft: "desktop.craft.canvas.cvH.review.draft",
  none: "desktop.craft.canvas.cvH.review.none",
};

export const HEALTH_WORD: Readonly<Record<PluginHealthState, MessageId>> = {
  ok: "desktop.craft.canvas.cvH.health.ok",
  idle: "desktop.craft.canvas.cvH.health.idle",
  error: "desktop.craft.canvas.cvH.health.error",
  stopped: "desktop.craft.canvas.cvH.health.stopped",
  integrity: "desktop.craft.canvas.cvH.health.integrity",
};

export const ORIGIN_WORD: Readonly<Record<PluginOriginKind, MessageId>> = {
  builtin: "desktop.craft.canvas.cvH.origin.builtin",
  bundled: "desktop.craft.canvas.cvH.origin.bundled",
  user: "desktop.craft.canvas.cvH.origin.user",
  project: "desktop.craft.canvas.cvH.origin.project",
  managed: "desktop.craft.canvas.cvH.origin.managed",
};

export const ENFORCEMENT_WORD: Readonly<Record<PluginEnforcement, MessageId>> = {
  advisory: "desktop.craft.canvas.cvH.enforcement.advisory",
  enforced: "desktop.craft.canvas.cvH.enforcement.enforced",
};

export const RELATION_WORD: Readonly<Record<RelationKind, MessageId>> = {
  handoff: "desktop.craft.canvas.cvH.rel.handoff",
  depends: "desktop.craft.canvas.cvH.rel.depends",
  replaces: "desktop.craft.canvas.cvH.rel.replaces",
  creates: "desktop.craft.canvas.cvH.rel.creates",
  owns: "desktop.craft.canvas.cvH.rel.owns",
};

export const STEP_WORD: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: "desktop.craft.canvas.cvH.step.diverge",
  explore: "desktop.craft.canvas.cvH.step.explore",
  apply: "desktop.craft.canvas.cvH.step.apply",
  check: "desktop.craft.canvas.cvH.step.check",
  judge: "desktop.craft.canvas.cvH.step.judge",
  search: "desktop.craft.canvas.cvH.step.search",
  read: "desktop.craft.canvas.cvH.step.read",
  summarize: "desktop.craft.canvas.cvH.step.summarize",
};

export const LANE_WORD: Readonly<Record<"code" | "docs" | "tests", MessageId>> = {
  code: "desktop.craft.canvas.cvH.lane.code",
  docs: "desktop.craft.canvas.cvH.lane.docs",
  tests: "desktop.craft.canvas.cvH.lane.tests",
};

export const PROFILE_WORD: Readonly<Record<"dev" | "scale" | "empty", MessageId>> = {
  dev: "desktop.craft.canvas.cvH.profile.dev",
  scale: "desktop.craft.canvas.sample.scale",
  empty: "desktop.craft.canvas.cvH.profile.empty",
};
