// cvA 화면 문구: 모델 값 → 메시지 키. 블록·경계 이름은 엔진의 블록 모델(`BLOCK_MODEL`)의 라벨을 그대로 쓴다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type {
  Decision,
  GrantId,
  Holding,
  Kind,
  Port,
  PluginSpec,
  Risk,
  StationId,
  StepKind,
  Unit,
} from "./model.ts";
import { stationOfPort } from "./model.ts";

export const KIND_KEY: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvA.kind.inject",
  hook: "desktop.craft.canvas.cvA.kind.hook",
  drive: "desktop.craft.canvas.cvA.kind.drive",
  tool: "desktop.craft.canvas.cvA.kind.tool",
};

export const DECISION_KEY: Readonly<Record<Decision, MessageId>> = {
  block: "desktop.craft.canvas.cvA.decision.block",
  replace: "desktop.craft.canvas.cvA.decision.replace",
  ask: "desktop.craft.canvas.cvA.decision.ask",
};

const HOLD_KEY: Readonly<Record<Unit, MessageId>> = {
  instruction: "desktop.craft.canvas.cvA.hold.instruction",
  skill: "desktop.craft.canvas.cvA.hold.skill",
  memory: "desktop.craft.canvas.cvA.hold.memory",
  tool: "desktop.craft.canvas.cvA.hold.tool",
  server: "desktop.craft.canvas.cvA.hold.server",
};

export const UNIT_KEY: Readonly<Record<Unit, MessageId>> = {
  instruction: "desktop.craft.canvas.cvA.unit.instruction",
  skill: "desktop.craft.canvas.cvA.unit.skill",
  memory: "desktop.craft.canvas.cvA.unit.memory",
  tool: "desktop.craft.canvas.cvA.unit.tool",
  server: "desktop.craft.canvas.cvA.unit.server",
};

export const RISK_KEY: Readonly<Record<Risk, MessageId>> = {
  read: "desktop.craft.canvas.cvA.risk.read",
  write: "desktop.craft.canvas.cvA.risk.write",
  exec: "desktop.craft.canvas.cvA.risk.exec",
};

export const GRANT_KEY: Readonly<Record<GrantId, MessageId>> = {
  fileRead: "desktop.craft.canvas.cvA.grant.fileRead",
  fileWrite: "desktop.craft.canvas.cvA.grant.fileWrite",
  childThread: "desktop.craft.canvas.cvA.grant.childThread",
  commandRun: "desktop.craft.canvas.cvA.grant.commandRun",
  memoryWrite: "desktop.craft.canvas.cvA.grant.memoryWrite",
  network: "desktop.craft.canvas.cvA.grant.network",
  repoWrite: "desktop.craft.canvas.cvA.grant.repoWrite",
};

export const STEP_KEY: Readonly<Record<StepKind, MessageId>> = {
  diverge: "desktop.craft.canvas.cvA.step.diverge",
  explore: "desktop.craft.canvas.cvA.step.explore",
  apply: "desktop.craft.canvas.cvA.step.apply",
  check: "desktop.craft.canvas.cvA.step.check",
  report: "desktop.craft.canvas.cvA.step.report",
  search: "desktop.craft.canvas.cvA.step.search",
  read: "desktop.craft.canvas.cvA.step.read",
  summarize: "desktop.craft.canvas.cvA.step.summarize",
};

/** 묶음 이름(표본 키). 모르는 이름은 그대로 */
export function groupName(name: string): string {
  return name === "quality" ? t("desktop.craft.canvas.cvA.group.quality") : name;
}

/** 레일 자리 이름: 블록 모델의 라벨(지금 언어) */
export function stationName(id: StationId): string {
  const ko = activeLocale() === "ko";
  const block = BLOCK_MODEL.blocks.find((b) => b.id === id);
  if (block !== undefined) return ko ? block.label.ko : block.label.en;
  const boundary = BLOCK_MODEL.boundaries.find((b) => b.id === id);
  if (boundary !== undefined) return ko ? boundary.label.ko : boundary.label.en;
  return id;
}

export function recordName(): string {
  const block = BLOCK_MODEL.blocks.find((b) => b.id === "record");
  if (block === undefined) return "";
  return activeLocale() === "ko" ? block.label.ko : block.label.en;
}

/** 붙는 곳 이름: "도구 실행 앞", "턴 종료 직전" */
export function portName(port: Port): string {
  const { station, side } = stationOfPort(port);
  const name = stationName(station);
  if (side === null) return name;
  return t(
    side === "before"
      ? "desktop.craft.canvas.cvA.port.before"
      : "desktop.craft.canvas.cvA.port.after",
    { station: name },
  );
}

export function holdingText(h: Holding): string {
  return t(HOLD_KEY[h.unit], { count: h.count });
}

/** 노드 둘째 줄: Hook은 결정, Drive는 역할, 나머지는 담은 것 */
export function metaOf(spec: PluginSpec, start: boolean, receives: boolean): string {
  if (spec.kind === "hook") return t(DECISION_KEY[spec.decision ?? "block"]);
  if (spec.kind === "drive") {
    if (start) return t("desktop.craft.canvas.cvA.mark.start");
    if (receives) return t("desktop.craft.canvas.cvA.mark.receives");
    return t(KIND_KEY.drive);
  }
  if (spec.kind === "tool") {
    const tools = spec.holds.filter((h) => h.unit === "tool").map(holdingText);
    return spec.holds.some((h) => h.unit === "server")
      ? ["MCP", ...tools].join(" · ")
      : tools.join(" · ");
  }
  return spec.holds.map(holdingText).join(" · ");
}

/** "최근 사용" 한 줄 */
export function recentText(min: number | null): string {
  if (min === null) return t("desktop.craft.canvas.cvA.recent.never");
  if (min < 60)
    return t("desktop.craft.canvas.cvA.recent.min", { n: Math.max(1, Math.round(min)) });
  if (min < 1440) return t("desktop.craft.canvas.cvA.recent.hour", { n: Math.round(min / 60) });
  return t("desktop.craft.canvas.cvA.recent.day", { n: Math.round(min / 1440) });
}
