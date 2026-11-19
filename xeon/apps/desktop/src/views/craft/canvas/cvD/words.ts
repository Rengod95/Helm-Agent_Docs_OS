// cvD 화면 글의 message id 표. 종류·자리·결정·블록 이름을 한 곳에서 찾는다.
import type { MessageId } from "@fresnel/client/i18n";
import type { BlockId, BoundaryId, Decision, Kind, PointKey, Risk } from "./sample.ts";

export const KIND_WORD: Readonly<Record<Kind, MessageId>> = {
  inject: "desktop.craft.canvas.cvD.kind.inject",
  hook: "desktop.craft.canvas.cvD.kind.hook",
  drive: "desktop.craft.canvas.cvD.kind.drive",
  tool: "desktop.craft.canvas.cvD.kind.tool",
};

export const BLOCK_WORD: Readonly<Record<BlockId, MessageId>> = {
  context: "desktop.craft.canvas.cvD.block.context",
  model: "desktop.craft.canvas.cvD.block.model",
  tools: "desktop.craft.canvas.cvD.block.tools",
  ask: "desktop.craft.canvas.cvD.block.ask",
  agents: "desktop.craft.canvas.cvD.block.agents",
  record: "desktop.craft.canvas.cvD.block.record",
};

export const BOUNDARY_WORD: Readonly<Record<BoundaryId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cvD.boundary.start",
  "input-received": "desktop.craft.canvas.cvD.boundary.input",
  "before-turn-end": "desktop.craft.canvas.cvD.boundary.end",
};

export const DECISION_WORD: Readonly<Record<Decision, MessageId>> = {
  block: "desktop.craft.canvas.cvD.decision.block",
  replace: "desktop.craft.canvas.cvD.decision.replace",
  ask: "desktop.craft.canvas.cvD.decision.ask",
};

export const RISK_WORD: Readonly<Record<Risk, MessageId>> = {
  low: "desktop.craft.canvas.cvD.risk.low",
  medium: "desktop.craft.canvas.cvD.risk.medium",
  high: "desktop.craft.canvas.cvD.risk.high",
};

const POINT_WORD: Readonly<Record<PointKey, MessageId>> = {
  "before:context": "desktop.craft.canvas.cvD.point.beforeContext",
  "after:context": "desktop.craft.canvas.cvD.point.afterContext",
  "before:model": "desktop.craft.canvas.cvD.point.beforeModel",
  "after:model": "desktop.craft.canvas.cvD.point.afterModel",
  "before:tools": "desktop.craft.canvas.cvD.point.beforeTools",
  "after:tools": "desktop.craft.canvas.cvD.point.afterTools",
  "before:ask": "desktop.craft.canvas.cvD.point.beforeAsk",
  "after:ask": "desktop.craft.canvas.cvD.point.afterAsk",
  "before:agents": "desktop.craft.canvas.cvD.point.beforeAgents",
  "after:agents": "desktop.craft.canvas.cvD.point.afterAgents",
  "before:record": "desktop.craft.canvas.cvD.point.beforeRecord",
  "after:record": "desktop.craft.canvas.cvD.point.afterRecord",
  "boundary:conversation-start": "desktop.craft.canvas.cvD.boundary.start",
  "boundary:input-received": "desktop.craft.canvas.cvD.boundary.input",
  "boundary:before-turn-end": "desktop.craft.canvas.cvD.boundary.end",
  "feed:context": "desktop.craft.canvas.cvD.point.feedContext",
  "feed:tools": "desktop.craft.canvas.cvD.point.feedTools",
  drive: "desktop.craft.canvas.cvD.point.drive",
};

export function pointWord(point: PointKey): MessageId {
  return POINT_WORD[point];
}
