// cvE 화면 글의 message id 표. 표본의 이름 꼬리(`Part.key`, `Stage.key`)도 여기서 id로 바꾼다(모르는 꼬리는 그대로 보인다).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { Decision, HookPoint, Kind, Part, PartKind, Slot, StationId } from "./model.ts";

export const KIND_TEXT: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvE.kind.inject",
  hook: "desktop.craft.canvas.cvE.kind.hook",
  drive: "desktop.craft.canvas.cvE.kind.drive",
  tool: "desktop.craft.canvas.cvE.kind.tool",
};

export const STATION_TEXT: Readonly<Record<StationId, MessageId>> = {
  context: "desktop.craft.canvas.cvE.station.context",
  model: "desktop.craft.canvas.cvE.station.model",
  tools: "desktop.craft.canvas.cvE.station.tools",
  ask: "desktop.craft.canvas.cvE.station.ask",
  agents: "desktop.craft.canvas.cvE.station.agents",
  record: "desktop.craft.canvas.cvE.station.record",
};

const POINT_TEXT: Readonly<Record<HookPoint, MessageId>> = {
  input: "desktop.craft.canvas.cvE.point.input",
  "model.before": "desktop.craft.canvas.cvE.point.modelBefore",
  "tools.before": "desktop.craft.canvas.cvE.point.toolsBefore",
  "tools.after": "desktop.craft.canvas.cvE.point.toolsAfter",
  "ask.before": "desktop.craft.canvas.cvE.point.askBefore",
  "agents.before": "desktop.craft.canvas.cvE.point.agentsBefore",
  turnEnd: "desktop.craft.canvas.cvE.point.turnEnd",
};

export function slotText(slot: Slot): string {
  if (slot === "inside") return t("desktop.craft.canvas.cvE.slot.inside");
  if (slot === "socket") return t("desktop.craft.canvas.cvE.slot.socket");
  if (slot === "drive") return t("desktop.craft.canvas.cvE.slot.drive");
  return t(POINT_TEXT[slot]);
}

export function pointText(point: HookPoint): string {
  return t(POINT_TEXT[point]);
}

export const DECISION_TEXT: Readonly<Record<Decision, MessageId>> = {
  block: "desktop.craft.canvas.cvE.decision.block",
  replace: "desktop.craft.canvas.cvE.decision.replace",
  ask: "desktop.craft.canvas.cvE.decision.ask",
};

export const PART_KIND_TEXT: Readonly<Record<PartKind | "stage" | "handoff", MessageId>> = {
  instruction: "desktop.craft.canvas.cvE.part.instruction",
  skill: "desktop.craft.canvas.cvE.part.skill",
  tool: "desktop.craft.canvas.cvE.part.tool",
  mcp: "desktop.craft.canvas.cvE.part.mcp",
  memory: "desktop.craft.canvas.cvE.part.memory",
  handler: "desktop.craft.canvas.cvE.part.handler",
  setting: "desktop.craft.canvas.cvE.part.setting",
  permission: "desktop.craft.canvas.cvE.part.permission",
  stage: "desktop.craft.canvas.cvE.part.stage",
  handoff: "desktop.craft.canvas.cvE.part.handoff",
};

const RISK_TEXT: readonly MessageId[] = [
  "desktop.craft.canvas.cvE.risk.none",
  "desktop.craft.canvas.cvE.risk.low",
  "desktop.craft.canvas.cvE.risk.mid",
  "desktop.craft.canvas.cvE.risk.high",
];

function riskText(risk: number): string {
  const id = RISK_TEXT[Math.max(0, Math.min(3, risk))];
  return id === undefined ? "" : t(id);
}

const NAME_TEXT: Readonly<Record<string, MessageId>> = {
  dev: "desktop.craft.canvas.cvE.profile.dev",
  empty: "desktop.craft.canvas.cvE.profile.empty",
  quality: "desktop.craft.canvas.cvE.group.quality",
  diverge: "desktop.craft.canvas.cvE.stage.diverge",
  explore: "desktop.craft.canvas.cvE.stage.explore",
  apply: "desktop.craft.canvas.cvE.stage.apply",
  check: "desktop.craft.canvas.cvE.stage.check",
  judge: "desktop.craft.canvas.cvE.stage.judge",
  search: "desktop.craft.canvas.cvE.stage.search",
  read: "desktop.craft.canvas.cvE.stage.read",
  summarize: "desktop.craft.canvas.cvE.stage.summarize",
  houseRules: "desktop.craft.canvas.cvE.sample.houseRules",
  skillTests: "desktop.craft.canvas.cvE.sample.skillTests",
  skillRelease: "desktop.craft.canvas.cvE.sample.skillRelease",
  skillMigrate: "desktop.craft.canvas.cvE.sample.skillMigrate",
  skillReview: "desktop.craft.canvas.cvE.sample.skillCheck",
  skillBench: "desktop.craft.canvas.cvE.sample.skillBench",
  skillDocs: "desktop.craft.canvas.cvE.sample.skillDocs",
  memoryStore: "desktop.craft.canvas.cvE.sample.memoryStore",
  memoryTools: "desktop.craft.canvas.cvE.sample.memoryTools",
  memoryScope: "desktop.craft.canvas.cvE.sample.memoryScope",
  scanCall: "desktop.craft.canvas.cvE.sample.scanCall",
  patterns: "desktop.craft.canvas.cvE.sample.patterns",
  fixResult: "desktop.craft.canvas.cvE.sample.fixResult",
  linter: "desktop.craft.canvas.cvE.sample.linter",
  askOverCap: "desktop.craft.canvas.cvE.sample.askOverCap",
  cap: "desktop.craft.canvas.cvE.sample.cap",
  stageGuide: "desktop.craft.canvas.cvE.sample.stageGuide",
  planTool: "desktop.craft.canvas.cvE.sample.planTool",
  explorers: "desktop.craft.canvas.cvE.sample.explorers",
  verifyGuide: "desktop.craft.canvas.cvE.sample.verifyGuide",
  rounds: "desktop.craft.canvas.cvE.sample.rounds",
  githubTools: "desktop.craft.canvas.cvE.sample.githubTools",
  token: "desktop.craft.canvas.cvE.sample.token",
  checkMessage: "desktop.craft.canvas.cvE.sample.checkMessage",
  convention: "desktop.craft.canvas.cvE.sample.convention",
  researchGuide: "desktop.craft.canvas.cvE.sample.researchGuide",
  changelogRules: "desktop.craft.canvas.cvE.sample.changelogRules",
  runTests: "desktop.craft.canvas.cvE.sample.runTests",
};

/** 표본 이름 꼬리 → 글. 모르면 꼬리 그대로 */
export function nameText(key: string): string {
  const id = NAME_TEXT[key];
  return id === undefined ? key : t(id);
}

export function partName(part: Part): string {
  if (part.raw !== undefined) return part.raw;
  if (part.key !== undefined) return nameText(part.key);
  if (part.kind === "permission") return riskText(part.risk ?? 0);
  return t(PART_KIND_TEXT[part.kind]);
}

/** Inject·도구가 넣는 것 한 마디(지침 1, 스킬 6, 메모리, 도구 12) */
export function givesText(what: PartKind, count: number): string {
  if (what === "instruction") return t("desktop.craft.canvas.cvE.gives.instruction", { count });
  if (what === "skill") return t("desktop.craft.canvas.cvE.gives.skill", { count });
  if (what === "tool") return t("desktop.craft.canvas.cvE.gives.tool", { count });
  return t(PART_KIND_TEXT[what]);
}

export function usedText(min: number): string {
  return min < 60
    ? t("desktop.craft.canvas.cvE.used.min", { min })
    : t("desktop.craft.canvas.cvE.used.hour", { hour: Math.round(min / 60) });
}
