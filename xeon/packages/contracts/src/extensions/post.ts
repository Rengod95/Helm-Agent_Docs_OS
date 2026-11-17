import { Type, type TUnsafe } from "typebox";
import {
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
  type ImageContent,
  type JsonValue,
  type TextContent,
} from "../conversation/index.ts";
import type { SchemaProof } from "../base/schema-proof.ts";
import { RecordKindSchema, type RecordKind } from "./group-record.ts";

/** steer: 현재 step 도구 라운드 뒤 / followUp: 현재 turn 정착 뒤 / next: 다음 경계 뒤 모델 요청 한 번 */
export type PostWhen = "steer" | "followUp" | "next";

export type PostContent = string | readonly (TextContent | ImageContent)[];

export type PostItem =
  /** 사용자 메시지로 들어간다 */
  | { readonly kind: "user"; readonly content: PostContent }
  /** 확장 메시지. 모델 컨텍스트에 들어가고 display가 참이면 UI에도 보인다 */
  | {
      readonly kind: "context";
      /** FresnelCustomMessage.customType(F.conversation.spec §3.5.2) */
      readonly customType: RecordKind;
      readonly content: PostContent;
      readonly display: boolean;
      readonly details?: JsonValue;
    };

export interface PostOptions {
  readonly when: PostWhen;
  /** 대화 범위 멱등 키(1~64자). 같은 키의 두 번째 post는 큐에 넣지 않는다 */
  readonly requestId: string;
}

export interface PostReceipt {
  readonly requestId: string;
  /** 같은 requestId가 이미 있어 아무것도 넣지 않았으면 참 */
  readonly duplicate: boolean;
}

const PostContentShape = Type.Union([
  Type.String(),
  Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
]);

const PostItemShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("user"), content: PostContentShape },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("context"),
      customType: RecordKindSchema,
      content: PostContentShape,
      display: Type.Boolean(),
      details: Type.Optional(JsonValueSchema),
    },
    { additionalProperties: false },
  ),
]);

/** `PostItem`의 검사. 엔진의 `post` 요청과 주도 명령의 `turn` 입력이 같은 모양을 쓴다 */
export const PostItemSchema: TUnsafe<PostItem> = Type.Unsafe<PostItem>(
  PostItemShape satisfies SchemaProof<PostItem, typeof PostItemShape>,
);
