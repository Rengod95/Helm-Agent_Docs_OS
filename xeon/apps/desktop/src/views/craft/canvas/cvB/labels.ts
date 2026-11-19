// cvB 화면 글. 모든 문구는 `desktop.craft.canvas.cvB.*` 키에서 온다. 플러그인 이름과 파일·도구 이름은 값이라 옮기지 않는다.
import { assertNever } from "@fresnel/contracts";
import { t, type MessageId } from "@fresnel/client/i18n";
import type {
  Anchor,
  Block,
  Boundary,
  CvbPlugin,
  Kind,
  Recent,
  Risk,
  Side,
  Title,
  Verb,
} from "./model.ts";

const KIND: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvB.kind.inject",
  hook: "desktop.craft.canvas.cvB.kind.hook",
  drive: "desktop.craft.canvas.cvB.kind.drive",
  tool: "desktop.craft.canvas.cvB.kind.tool",
};

const BLOCK: Readonly<Record<Block, MessageId>> = {
  context: "desktop.craft.canvas.cvB.block.context",
  model: "desktop.craft.canvas.cvB.block.model",
  tools: "desktop.craft.canvas.cvB.block.tools",
  ask: "desktop.craft.canvas.cvB.block.ask",
  agents: "desktop.craft.canvas.cvB.block.agents",
  record: "desktop.craft.canvas.cvB.block.record",
};

const BOUNDARY: Readonly<Record<Boundary, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cvB.boundary.start",
  "input-received": "desktop.craft.canvas.cvB.boundary.input",
  "before-turn-end": "desktop.craft.canvas.cvB.boundary.end",
};

const SIDE: Readonly<Record<Side, MessageId>> = {
  before: "desktop.craft.canvas.cvB.side.before",
  after: "desktop.craft.canvas.cvB.side.after",
  feed: "desktop.craft.canvas.cvB.side.feed",
};

const VERB: Readonly<Record<Verb, MessageId>> = {
  block: "desktop.craft.canvas.cvB.verb.block",
  replace: "desktop.craft.canvas.cvB.verb.replace",
  ask: "desktop.craft.canvas.cvB.verb.ask",
};

const RISK: Readonly<Record<Risk, MessageId>> = {
  none: "desktop.craft.canvas.cvB.risk.none",
  read: "desktop.craft.canvas.cvB.risk.read",
  write: "desktop.craft.canvas.cvB.risk.write",
  exec: "desktop.craft.canvas.cvB.risk.exec",
};

export const kindName = (kind: Kind): string => t(KIND[kind]);
export const blockName = (block: Block): string => t(BLOCK[block]);
export const boundaryName = (boundary: Boundary): string => t(BOUNDARY[boundary]);
export const verbName = (verb: Verb): string => t(VERB[verb]);
export const riskName = (risk: Risk): string => t(RISK[risk]);

/** 프로필·묶음 이름 */
export function titleText(title: Title): string {
  return "id" in title ? t(title.id) : title.text;
}

/** 붙는 곳 한 줄("도구 실행 · 앞", "Drive") */
export function anchorName(anchor: Anchor): string {
  switch (anchor.at) {
    case "block":
      return t("desktop.craft.canvas.cvB.where", {
        block: blockName(anchor.block),
        side: t(SIDE[anchor.side]),
      });
    case "boundary":
      return boundaryName(anchor.boundary);
    case "drive":
      return t("desktop.craft.canvas.cvB.zone.label");
    default:
      return assertNever(anchor, "cvB.anchorName");
  }
}

/** 노드 둘째 줄의 본문(무엇이 들었나·무엇을 하나) */
export function metaText(plugin: CvbPlugin): string {
  const meta = plugin.meta;
  switch (meta.k) {
    case "rules":
      return t("desktop.craft.canvas.cvB.meta.rules", { n: meta.n });
    case "skills":
      return t("desktop.craft.canvas.cvB.meta.skills", { n: meta.n });
    case "memory":
      return t("desktop.craft.canvas.cvB.meta.memory");
    case "tools":
      return t("desktop.craft.canvas.cvB.meta.tools", { n: meta.n });
    case "steps":
      return t("desktop.craft.canvas.cvB.meta.steps", { n: meta.n });
    case "receives":
      return t("desktop.craft.canvas.cvB.meta.receives");
    case "verb": {
      const verb = verbName(plugin.verb ?? "block");
      if (plugin.anchor.at === "block" && plugin.anchor.side === "before") {
        return t("desktop.craft.canvas.cvB.meta.before", { verb });
      }
      if (plugin.anchor.at === "block" && plugin.anchor.side === "after") {
        return t("desktop.craft.canvas.cvB.meta.after", { verb });
      }
      return verb;
    }
    default:
      return assertNever(meta, "cvB.metaText");
  }
}

/** 노드 둘째 줄 앞에 붙는 표식(베이스·드래프트·스타트 Drive) */
export function metaTag(state: {
  readonly base: boolean;
  readonly draft: boolean;
  readonly start: boolean;
}): string | null {
  if (state.draft) return t("desktop.craft.canvas.cvB.tag.draft");
  if (state.start) return t("desktop.craft.canvas.cvB.tag.start");
  if (state.base) return t("desktop.craft.canvas.cvB.tag.base");
  return null;
}

/** 최근 사용 한 줄 */
export function recentText(recent: Recent | null): string {
  if (recent === null) return t("desktop.craft.canvas.cvB.recent.none");
  const m = recent.minutesAgo;
  const when =
    m < 60
      ? t("desktop.craft.canvas.cvB.recent.minutes", { n: m })
      : m < 60 * 24
        ? t("desktop.craft.canvas.cvB.recent.hours", { n: Math.floor(m / 60) })
        : t("desktop.craft.canvas.cvB.recent.days", { n: Math.floor(m / 60 / 24) });
  return t("desktop.craft.canvas.cvB.recent.line", { when, turns: recent.turns });
}

/** 화면 읽기 이름: 이름, 종류, 붙는 곳·하는 일, 표식 */
export function crystalAria(plugin: CvbPlugin, tag: string | null, rank: number | null): string {
  const parts = [plugin.id, kindName(plugin.kind), anchorName(plugin.anchor), metaText(plugin)];
  if (rank !== null) parts.push(t("desktop.craft.canvas.cvB.aria.rank", { n: rank }));
  if (tag !== null) parts.push(tag);
  return parts.join(", ");
}
