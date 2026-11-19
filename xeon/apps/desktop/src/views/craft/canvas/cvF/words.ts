// cvF 화면 글의 message id 표. 종류·자리·정거장·결정·카드 값의 이름을 한 곳에서 찾는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { HookPower, PluginCard } from "@fresnel/contracts/extensions";
import type { SharedRisk, SharedStepId } from "../shared-sample.ts";
import type { StopId } from "./layout.ts";
import type { Kind, Plugin, SpotKey } from "./model.ts";

export const KIND_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvF.kind.inject",
  hook: "desktop.craft.canvas.cvF.kind.hook",
  drive: "desktop.craft.canvas.cvF.kind.drive",
  tool: "desktop.craft.canvas.cvF.kind.tool",
};

export const STOP_WORD: Readonly<Record<StopId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cvF.stop.start",
  "input-received": "desktop.craft.canvas.cvF.stop.input",
  context: "desktop.craft.canvas.cvF.stop.context",
  model: "desktop.craft.canvas.cvF.stop.model",
  tools: "desktop.craft.canvas.cvF.stop.tools",
  ask: "desktop.craft.canvas.cvF.stop.ask",
  agents: "desktop.craft.canvas.cvF.stop.agents",
  "before-turn-end": "desktop.craft.canvas.cvF.stop.end",
  record: "desktop.craft.canvas.cvF.stop.record",
};

export const SPOT_WORD: Readonly<Record<SpotKey, MessageId>> = {
  "feed:context": "desktop.craft.canvas.cvF.spot.feedContext",
  "feed:tools": "desktop.craft.canvas.cvF.spot.feedTools",
  "before:model": "desktop.craft.canvas.cvF.spot.beforeModel",
  "before:tools": "desktop.craft.canvas.cvF.spot.beforeTools",
  "after:tools": "desktop.craft.canvas.cvF.spot.afterTools",
  "boundary:before-turn-end": "desktop.craft.canvas.cvF.spot.end",
  drive: "desktop.craft.canvas.cvF.spot.drive",
};

export const DECISION_WORD: Readonly<Record<"block" | "replace" | "ask", MessageId>> = {
  block: "desktop.craft.canvas.cvF.decision.block",
  replace: "desktop.craft.canvas.cvF.decision.replace",
  ask: "desktop.craft.canvas.cvF.decision.ask",
};

export const RISK_WORD: Readonly<Record<SharedRisk, MessageId>> = {
  none: "desktop.craft.canvas.cvF.risk.none",
  read: "desktop.craft.canvas.cvF.risk.read",
  write: "desktop.craft.canvas.cvF.risk.write",
  exec: "desktop.craft.canvas.cvF.risk.exec",
};

export const REVIEW_WORD: Readonly<Record<PluginCard["review"]["state"], MessageId>> = {
  approved: "desktop.craft.canvas.cvF.review.approved",
  pending: "desktop.craft.canvas.cvF.review.pending",
  draft: "desktop.craft.canvas.cvF.review.draft",
  none: "desktop.craft.canvas.cvF.review.none",
};

export const ORIGIN_WORD: Readonly<Record<PluginCard["origin"]["kind"], MessageId>> = {
  builtin: "desktop.craft.canvas.cvF.origin.builtin",
  bundled: "desktop.craft.canvas.cvF.origin.bundled",
  user: "desktop.craft.canvas.cvF.origin.user",
  project: "desktop.craft.canvas.cvF.origin.project",
  managed: "desktop.craft.canvas.cvF.origin.managed",
};

export const HEALTH_WORD: Readonly<Record<PluginCard["health"]["state"], MessageId>> = {
  ok: "desktop.craft.canvas.cvF.health.ok",
  idle: "desktop.craft.canvas.cvF.health.idle",
  error: "desktop.craft.canvas.cvF.health.error",
  stopped: "desktop.craft.canvas.cvF.health.stopped",
  integrity: "desktop.craft.canvas.cvF.health.integrity",
};

export const ENFORCEMENT_WORD: Readonly<Record<PluginCard["enforcement"], MessageId>> = {
  advisory: "desktop.craft.canvas.cvF.enforcement.advisory",
  enforced: "desktop.craft.canvas.cvF.enforcement.enforced",
};

export const POWER_WORD: Readonly<Record<HookPower, MessageId>> = {
  observe: "desktop.craft.canvas.cvF.power.observe",
  modify: "desktop.craft.canvas.cvF.power.modify",
  decide: "desktop.craft.canvas.cvF.power.decide",
  contribute: "desktop.craft.canvas.cvF.power.contribute",
};

export const STAGE_WORD: Readonly<Record<SharedStepId, MessageId>> = {
  diverge: "desktop.craft.canvas.cvF.stage.diverge",
  explore: "desktop.craft.canvas.cvF.stage.explore",
  apply: "desktop.craft.canvas.cvF.stage.apply",
  check: "desktop.craft.canvas.cvF.stage.check",
  judge: "desktop.craft.canvas.cvF.stage.judge",
  search: "desktop.craft.canvas.cvF.stage.search",
  read: "desktop.craft.canvas.cvF.stage.read",
  summarize: "desktop.craft.canvas.cvF.stage.summarize",
};

export const LANE_WORD: Readonly<Record<"code" | "docs" | "tests", MessageId>> = {
  code: "desktop.craft.canvas.cvF.lane.code",
  docs: "desktop.craft.canvas.cvF.lane.docs",
  tests: "desktop.craft.canvas.cvF.lane.tests",
};

/** 카드 둘째 줄: "Hook · 도구 실행 앞" */
export function metaLine(p: Plugin): string {
  return `${t(KIND_WORD[p.kind])} · ${t(SPOT_WORD[p.spot])}`;
}

/** 카드 넷째 줄: 핵심 구성 요소를 숫자로("지침 1 · 스킬 6") */
export function partsLine(p: Plugin): string {
  const bits: string[] = [];
  if (p.instructions.length > 0)
    bits.push(t("desktop.craft.canvas.cvF.parts.instructions", { n: p.instructions.length }));
  if (p.skills.length > 0)
    bits.push(t("desktop.craft.canvas.cvF.parts.skills", { n: p.skills.length }));
  if (p.memory.length > 0)
    bits.push(t("desktop.craft.canvas.cvF.parts.memory", { n: p.memory.length }));
  if (p.mcp !== undefined) {
    bits.push(t("desktop.craft.canvas.cvF.parts.tools", { n: p.mcp.tools.length }));
    const writes = p.mcp.tools.filter((x) => x.writes).length;
    if (writes > 0) bits.push(t("desktop.craft.canvas.cvF.parts.writes", { n: writes }));
  }
  if (p.steps !== undefined) {
    bits.push(t("desktop.craft.canvas.cvF.parts.stages", { n: p.steps.length }));
    const lanes = Math.max(...p.steps.map((s) => s.parallel));
    if (lanes > 1) bits.push(t("desktop.craft.canvas.cvF.parts.lanes", { n: lanes }));
  }
  if (p.decision !== undefined) bits.push(t(DECISION_WORD[p.decision]));
  if (bits.length === 0 && p.settings.length > 0)
    bits.push(t("desktop.craft.canvas.cvF.parts.settings", { n: p.settings.length }));
  return bits.join(" · ");
}
