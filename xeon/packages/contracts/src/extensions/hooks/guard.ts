import { Type, type Static, type TLiteral, type TObject, type TString, type TUnion } from "typebox";
import { ThreadIdSchema, TurnIdSchema } from "../../conversation/index.ts";

// guard 지점 셋(adr.0017 §3.6). 모델 요청 직전과 도구 호출 직전은 같은 대상의 일반 지점 페이로드
// (BeforeProviderRequestPayload, ToolCallPayload)를 그대로 쓴다. 출력 직전만 새 페이로드가 필요하다.

const TEXT_MAX = 4_000_000;

/** 출력이 넘어갈 곳. [가정] L1·L4 출력 경로 목록이 정해진 뒤 확정한다(adr.0017 §6) */
export const GuardOutputTargetSchema: TUnion<[TLiteral<"display">, TLiteral<"execution">]> =
  Type.Union([Type.Literal("display"), Type.Literal("execution")]);
export type GuardOutputTarget = Static<typeof GuardOutputTargetSchema>;

export const GuardOutputPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  turnId: typeof TurnIdSchema;
  target: typeof GuardOutputTargetSchema;
  content: TString;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    turnId: TurnIdSchema,
    target: GuardOutputTargetSchema,
    content: Type.String({ maxLength: TEXT_MAX }),
  },
  { additionalProperties: false },
);
export type GuardOutputPayload = Static<typeof GuardOutputPayloadSchema>;

/**
 * 가드 결정. 차단만 값으로 낸다. `undefined`는 의견 없음이라 통과다.
 * 허용을 값으로 내면 `first`가 뒤 가드를 멈추므로 두지 않는다. 핸들러는 값을 바꾸지 못한다.
 */
export const GuardDecisionSchema: TObject<{ block: TLiteral<true>; reason: TString }> = Type.Object(
  { block: Type.Literal(true), reason: Type.String({ maxLength: 500 }) },
  { additionalProperties: false },
);
export type GuardDecision = Static<typeof GuardDecisionSchema>;
