import {
  Type,
  type Static,
  type TArray,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";
import { Nullable } from "../base/index.ts";

// 테스트 대화(Craft 전용 대화)의 표지(M5c §4.8.1). 표지는 thread.started.craftChat이 쓰고 thread.updated.craftChat이 플러그인에 묶는다.
// 맥락은 참조로만 전달한다(M5c §4.8.8): 모델 컨텍스트에 줄을 더하지 않고 이 참조를 대화에 기록한다.

/** 플러그인 이름 상한. 확장 이름 문법의 상한과 같다(TurnInvoked.plugin) */
const CRAFT_PLUGIN_MAX = 96;
/** 참조 안의 id 하나의 상한 [제안] */
const CRAFT_REF_ID_MAX = 128;
/** 표지 하나에 든 맥락 참조 수 상한 [제안] */
const CRAFT_CONTEXTS_MAX = 16;

/**
 * 맥락 참조(M5c §4.8.8). 닫힌 판별 유니온이다. 참조가 가리키는 내용은 호스트가 읽는다(발견이면 근거 묶음, 턴이면 기록).
 * 이 값은 대화 기록에 남을 뿐 모델에 직접 주지 않는다.
 */
export const ContextRefSchema: TUnion<
  [
    TObject<{ kind: TLiteral<"plugin">; name: TString }>,
    TObject<{ kind: TLiteral<"finding">; findingId: TString }>,
    TObject<{ kind: TLiteral<"turn">; threadId: TString; turnId: TString }>,
    TObject<{ kind: TLiteral<"call">; threadId: TString; turnId: TString; toolCallId: TString }>,
    TObject<{ kind: TLiteral<"replay">; runId: TString }>,
    TObject<{ kind: TLiteral<"review">; itemId: TString }>,
    TObject<{ kind: TLiteral<"draft">; draftId: TString }>,
  ]
> = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("plugin"),
      name: Type.String({ minLength: 1, maxLength: CRAFT_PLUGIN_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("finding"),
      findingId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("turn"),
      threadId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
      turnId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("call"),
      threadId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
      turnId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
      toolCallId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("replay"),
      runId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("review"),
      itemId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("draft"),
      draftId: Type.String({ minLength: 1, maxLength: CRAFT_REF_ID_MAX }),
    },
    { additionalProperties: false },
  ),
]);
export type ContextRef = Static<typeof ContextRefSchema>;

/** 맥락 참조 목록. 표지와 `craftChat.open`이 같은 상한을 쓴다 */
export const CraftContextsSchema: TArray<typeof ContextRefSchema> = Type.Array(ContextRefSchema, {
  maxItems: CRAFT_CONTEXTS_MAX,
});

/** `thread.started.craftChat`: 만들 때의 표지. 새 플러그인을 만드는 동안은 plugin이 null이다 */
export const CraftChatStartedSchema: TObject<{
  plugin: TUnion<[TString, TNull]>;
  contexts: typeof CraftContextsSchema;
}> = Type.Object(
  {
    plugin: Nullable(Type.String({ minLength: 1, maxLength: CRAFT_PLUGIN_MAX })),
    contexts: CraftContextsSchema,
  },
  { additionalProperties: false },
);
export type CraftChatStarted = Static<typeof CraftChatStartedSchema>;

/** `thread.updated.craftChat`: 플러그인에 한 번 묶는다. 묶인 뒤의 값은 바꾸지 않는다 */
export const CraftChatBindSchema: TObject<{ plugin: TString }> = Type.Object(
  { plugin: Type.String({ minLength: 1, maxLength: CRAFT_PLUGIN_MAX }) },
  { additionalProperties: false },
);
export type CraftChatBind = Static<typeof CraftChatBindSchema>;

/** 대화 요약(`ThreadSummary.craftChat`)에 싣는 표지. 맥락 참조는 싣지 않는다 */
export const CraftChatSummarySchema: TObject<{ plugin: TUnion<[TString, TNull]> }> = Type.Object(
  { plugin: Nullable(Type.String({ minLength: 1, maxLength: CRAFT_PLUGIN_MAX })) },
  { additionalProperties: false },
);
export type CraftChatSummary = Static<typeof CraftChatSummarySchema>;
