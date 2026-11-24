// 구성 탭 캔버스(plugHead)의 글 표. 지점 이름과 자리 이름, fold 글은 프로필 캔버스(cv3, cv6)의 글을 그대로 쓰고,
// 지점이 무엇인지 설명하는 문장과 이 화면에만 있는 글은 `desktop.craft.loop.*`이다.
import type { MessageId } from "@fresnel/client/i18n";
import type { HookPower } from "@fresnel/contracts/extensions";
import type { FeedItem, FeedPoint, LoopBlock, PointId, Spot } from "./loop-model.ts";

/** 지점 이름(프로필 캔버스와 같은 말) */
export const POINT_WORD: Readonly<Record<PointId, MessageId>> = {
  "conversation-start": "desktop.craft.canvas.cv3.boundary.start",
  "input-received": "desktop.craft.canvas.cv3.boundary.input",
  context: "desktop.craft.canvas.cv3.block.context",
  model: "desktop.craft.canvas.cv3.block.model",
  tools: "desktop.craft.canvas.cv3.block.tools",
  ask: "desktop.craft.canvas.cv3.block.ask",
  agents: "desktop.craft.canvas.cv3.block.agents",
  record: "desktop.craft.canvas.cv3.block.record",
  "before-turn-end": "desktop.craft.canvas.cv3.boundary.end",
};

/** 지점이 무엇이고 루프의 언제인지 사람 말로(엔진 블록 모델의 블록과 경계 하나씩) */
export const POINT_WHAT: Readonly<Record<PointId, MessageId>> = {
  "conversation-start": "desktop.craft.loop.point.start",
  "input-received": "desktop.craft.loop.point.input",
  context: "desktop.craft.loop.point.context",
  model: "desktop.craft.loop.point.model",
  tools: "desktop.craft.loop.point.tools",
  ask: "desktop.craft.loop.point.ask",
  agents: "desktop.craft.loop.point.agents",
  record: "desktop.craft.loop.point.record",
  "before-turn-end": "desktop.craft.loop.point.end",
};

/** 블록 앞뒤 문의 이름(프로필 캔버스와 같은 말) */
const GATE_WORD: Readonly<
  Record<`${"before" | "after"}:${Exclude<LoopBlock, "record">}`, MessageId>
> = {
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
};

/** 자리의 이름: 문은 "도구 실행 앞", 경계와 기록은 지점 이름, 루프 밖은 "루프 밖" */
export function spotWord(spot: Spot): MessageId {
  if (spot.kind === "gate") return GATE_WORD[`${spot.side}:${spot.block}`];
  if (spot.kind === "on") return POINT_WORD[spot.point];
  return "desktop.craft.loop.outside";
}

/** 훅이 할 수 있는 일(프로필 캔버스 상세의 "영향" 줄과 같은 말) */
export const POWER_WORD: Readonly<Record<HookPower, MessageId>> = {
  observe: "desktop.craft.canvas.cv3.fact.changes.observe",
  modify: "desktop.craft.canvas.cv3.fact.changes.modify",
  decide: "desktop.craft.canvas.cv3.fact.changes.decide",
  contribute: "desktop.craft.canvas.cv3.fact.changes.contribute",
};

/** 재료 카드의 제목: 어느 블록에 무엇을 넣나 */
export const FEED_WORD: Readonly<Record<FeedPoint, MessageId>> = {
  context: "desktop.craft.canvas.cv3.at.feedContext",
  tools: "desktop.craft.canvas.cv3.at.feedTools",
  agents: "desktop.craft.loop.feed.agents",
};

/** 재료 한 칸의 종류 말 */
export const FEED_ITEM_WORD: Readonly<Record<FeedItem["kind"], MessageId>> = {
  instruction: "desktop.craft.loop.item.instruction",
  skill: "desktop.craft.loop.item.skill",
  command: "desktop.craft.loop.item.command",
  tool: "desktop.craft.loop.item.tool",
  server: "desktop.craft.loop.item.server",
  agent: "desktop.craft.loop.item.agent",
};
