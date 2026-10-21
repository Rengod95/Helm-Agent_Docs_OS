import type {
  Context as PiContext,
  Message as PiMessage,
  Tool as PiTool,
} from "@earendil-works/pi-ai";
import { parse } from "@xeon/contracts";
import type { Context, Message, Tool } from "@xeon/contracts/conversation";
import { Type } from "typebox";

// F의 pi 타입 자리(contracts/src/conversation/pi.ts)와 pi-ai 1.3.0 타입의 경계 변환. 두 정의가 다른 곳은 하나뿐이다:
// Tool.constrainedSampling이 F에서는 JsonObject, pi-ai에서는 { type: "grammar", variants }다. F를 pi-ai로 보내는
// 방향(요청 컨텍스트, 토큰 추정)에서만 변환하고, pi-ai 값을 F 타입으로 돌려주는 방향은 구조적으로 대입된다.
// 문법 제약으로 읽히지 않는 값은 버린다. 제약은 샘플링 최적화라 빠져도 요청이 틀리지 않는다.
// pi 의존이 F에 연결되면(contracts pi.ts 머리말) 이 파일은 필요 없어진다.

const GrammarConfigSchema = Type.Object(
  {
    type: Type.Literal("grammar"),
    variants: Type.Object(
      { openai_lark: Type.Optional(Type.String()), openai_regex: Type.Optional(Type.String()) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export function toPiTool(tool: Tool): PiTool {
  const { constrainedSampling, ...rest } = tool;
  if (constrainedSampling === undefined) return rest;
  if (constrainedSampling === false) return { ...rest, constrainedSampling: false };
  const grammar = parse(GrammarConfigSchema, constrainedSampling);
  return grammar.ok ? { ...rest, constrainedSampling: grammar.value } : rest;
}

export function toPiMessage(message: Message): PiMessage {
  if (message.role !== "system") return message;
  const { toolsAdded, ...rest } = message;
  return toolsAdded === undefined ? rest : { ...rest, toolsAdded: toolsAdded.map(toPiTool) };
}

export function toPiMessages(messages: readonly Message[]): PiMessage[] {
  return messages.map(toPiMessage);
}

export function toPiContext(context: Context): PiContext {
  return {
    ...(context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt }),
    messages: toPiMessages(context.messages),
    ...(context.tools === undefined ? {} : { tools: context.tools.map(toPiTool) }),
  };
}
