// cvC 화면의 글. 지점 이름은 엔진 상수 `BLOCK_MODEL`의 표기(ko·en)를 그대로 쓰고, 나머지는 `desktop.craft.canvas.cvC.*` 글 키다.
import { activeLocale, t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type { PointId, Side } from "./model.ts";
import type { Decision, Give, PermissionKey, PluginKind, Risk, StepId } from "./sample.ts";

export function pointLabel(point: PointId): string {
  const ko = activeLocale() === "ko";
  for (const b of BLOCK_MODEL.blocks) if (b.id === point) return ko ? b.label.ko : b.label.en;
  for (const b of BLOCK_MODEL.boundaries) if (b.id === point) return ko ? b.label.ko : b.label.en;
  return point;
}

export function kindLabel(kind: PluginKind): string {
  switch (kind) {
    case "inject":
      return t("desktop.craft.canvas.cvC.kind.inject");
    case "hook":
      return t("desktop.craft.canvas.cvC.kind.hook");
    case "drive":
      return t("desktop.craft.canvas.cvC.kind.drive");
    case "tool":
      return t("desktop.craft.canvas.cvC.kind.tool");
    default:
      return assertNever(kind, "kindLabel");
  }
}

export function sideLabel(side: Side): string {
  switch (side) {
    case "before":
      return t("desktop.craft.canvas.cvC.side.before");
    case "after":
      return t("desktop.craft.canvas.cvC.side.after");
    case "in":
      return t("desktop.craft.canvas.cvC.side.in");
    case "at":
      return t("desktop.craft.canvas.cvC.side.at");
    default:
      return assertNever(side, "sideLabel");
  }
}

export function decisionLabel(d: Decision): string {
  switch (d) {
    case "block":
      return t("desktop.craft.canvas.cvC.decision.block");
    case "replace":
      return t("desktop.craft.canvas.cvC.decision.replace");
    case "ask":
      return t("desktop.craft.canvas.cvC.decision.ask");
    default:
      return assertNever(d, "decisionLabel");
  }
}

export function giveLabel(g: Give): string {
  const count = g.count;
  switch (g.what) {
    case "instructions":
      return t("desktop.craft.canvas.cvC.give.instructions", { count });
    case "skill":
      return t("desktop.craft.canvas.cvC.give.skill", { count });
    case "memory":
      return t("desktop.craft.canvas.cvC.give.memory");
    case "mcp":
      return t("desktop.craft.canvas.cvC.give.mcp", { count });
    case "tool":
      return t("desktop.craft.canvas.cvC.give.tool", { count });
    default:
      return assertNever(g.what, "giveLabel");
  }
}

export function riskLabel(r: Risk): string {
  switch (r) {
    case "none":
      return t("desktop.craft.canvas.cvC.risk.none");
    case "low":
      return t("desktop.craft.canvas.cvC.risk.low");
    case "mid":
      return t("desktop.craft.canvas.cvC.risk.mid");
    case "high":
      return t("desktop.craft.canvas.cvC.risk.high");
    default:
      return assertNever(r, "riskLabel");
  }
}

export function permissionLabel(p: PermissionKey): string {
  switch (p) {
    case "read":
      return t("desktop.craft.canvas.cvC.perm.read");
    case "write":
      return t("desktop.craft.canvas.cvC.perm.write");
    case "shell":
      return t("desktop.craft.canvas.cvC.perm.shell");
    case "network":
      return t("desktop.craft.canvas.cvC.perm.network");
    case "none":
      return t("desktop.craft.canvas.cvC.perm.none");
    default:
      return assertNever(p, "permissionLabel");
  }
}

/** Drive 단계 이름. 표본의 단계 id → 글 키 */
export function stepLabel(id: StepId): string {
  switch (id) {
    case "diverge":
      return t("desktop.craft.canvas.cvC.step.diverge");
    case "explore":
      return t("desktop.craft.canvas.cvC.step.explore");
    case "apply":
      return t("desktop.craft.canvas.cvC.step.apply");
    case "check":
      return t("desktop.craft.canvas.cvC.step.check");
    case "judge":
      return t("desktop.craft.canvas.cvC.step.judge");
    case "search":
      return t("desktop.craft.canvas.cvC.step.search");
    case "read":
      return t("desktop.craft.canvas.cvC.step.read");
    case "summarize":
      return t("desktop.craft.canvas.cvC.step.summarize");
    case "code":
      return t("desktop.craft.canvas.cvC.step.code");
    case "docs":
      return t("desktop.craft.canvas.cvC.step.docs");
    case "tests":
      return t("desktop.craft.canvas.cvC.step.tests");
    default:
      return assertNever(id, "stepLabel");
  }
}

/** 최근 사용 한 줄 */
export function lastUsedLabel(min: number | undefined): string {
  if (min === undefined) return t("desktop.craft.canvas.cvC.lastUsed.never");
  if (min < 60) return t("desktop.craft.canvas.cvC.lastUsed.min", { count: min });
  return t("desktop.craft.canvas.cvC.lastUsed.hour", { count: Math.round(min / 60) });
}
